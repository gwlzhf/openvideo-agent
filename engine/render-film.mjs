// Film renderer. Opens the built film in headless Chromium, takes one screenshot per frame at exact film times,
// and hands the frames to ffmpeg. Options:
//   --output <file>     where to write (.mp4 for a film, .png for --still)
//   --audio <wav>       the verified master from mix-audio (required for a delivered film)
//   --still <seconds>   render one frame instead of the whole film
//   --from / --to      render only part of the film (no master needed for a partial render)
//   --silent-demo       technical test without audio; refused for a real plan
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserArgs, describeHardware, encodeArgs, run} from './pick-hardware.mjs';
import {serve} from './static-server.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readOptions(argv) {
  const opts = {output: 'renders/technical-demo.mp4', still: null, audio: null, from: 0, to: null, silentDemo: false};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${key} needs a value`);
      return argv[i];
    };
    switch (key) {
      case '--output': opts.output = value(); break;
      case '--still': opts.still = Number(value()); break;
      case '--audio': opts.audio = value(); break;
      case '--from': opts.from = Number(value()); break;
      case '--to': opts.to = Number(value()); break;
      case '--silent-demo': opts.silentDemo = true; break;
      default: throw new Error(`unknown option ${key}`);
    }
  }
  return opts;
}

// A delivered film may only be rendered from the master that mix-audio verified for this exact plan.
async function verifyMasterGate(plan, audio) {
  const mix = JSON.parse(await readFile('evidence/audio-mix.json', 'utf8'));
  if (mix.planSha256 !== sha256(await readFile('plan.json'))) {
    throw new Error('evidence/audio-mix.json belongs to an older plan; run mix-audio again');
  }
  if (!mix.cues?.length) throw new Error('the audio mix has no sound-effect cues');
  if (!audio || sha256(await readFile(audio)) !== mix.master.sha256) {
    throw new Error('--audio is not the master recorded in evidence/audio-mix.json');
  }
}

async function preflight(opts, plan) {
  const from = opts.from;
  const to = opts.to ?? plan.duration;
  const partial = from > 0 || to < plan.duration;
  const approvedSilent = !plan.demo && plan.audioRequired === false &&
    typeof plan.audioExceptionReason === 'string' && plan.audioExceptionReason.trim() !== '';
  const fullFilm = opts.still === null && !partial;
  if (fullFilm && !opts.audio && !approvedSilent && !opts.silentDemo) {
    throw new Error('a full render needs --audio <master.wav>; silent test renders need --silent-demo');
  }
  if (fullFilm && !plan.demo && opts.silentDemo) throw new Error('--silent-demo is only for technical samples');
  if (fullFilm && !plan.demo && plan.audioRequired && plan.sfxRequired !== false) {
    await verifyMasterGate(plan, opts.audio);
  }
}

// Loads the film and collects anything that went wrong while it loaded.
async function openFilm(browser, url, plan) {
  const page = await browser.newPage({viewport: {width: plan.width, height: plan.height}, deviceScaleFactor: 1});
  const problems = [];
  page.on('pageerror', err => problems.push(err.message));
  page.on('requestfailed', req => problems.push(`request failed: ${req.url()}`));
  page.on('response', res => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()} ${res.url()}`);
  });
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__filmReady);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.allSettled([...document.images].map(img => img.decode())));
  return {page, problems};
}

const seekTo = (page, seconds) => page.evaluate(sec => window.seek(sec), seconds);

async function captureFrames(page, plan, from, to, dir) {
  const first = Math.round(from * plan.fps);
  const last = Math.round(to * plan.fps);
  const started = Date.now();
  for (let f = first; f < last; f++) {
    await seekTo(page, f / plan.fps);   // seek can await interactions such as clicks and popovers
    const name = `${String(f - first).padStart(6, '0')}.jpg`;
    await page.screenshot({path: path.join(dir, name), type: 'jpeg', quality: 95});
    if ((f - first) % 300 === 0) {
      console.log(`frame ${f}/${last} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  }
}

async function encodeFrames(dir, plan, opts, from, to) {
  const frameInput = ['-framerate', String(plan.fps), '-i', path.join(dir, '%06d.jpg')];
  const audioInput = opts.audio
    ? ['-ss', String(from), '-i', opts.audio, '-map', '1:a:0', '-af', 'apad', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000']
    : [];
  const videoOut = [...encodeArgs, '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const videoMap = opts.audio ? ['-map', '0:v:0'] : [];
  await run('ffmpeg', ['-v', 'error', '-y', ...frameInput, ...audioInput, ...videoMap, '-t', String(to - from), ...videoOut, opts.output]);
}

async function main() {
  const opts = readOptions(process.argv.slice(2));
  const plan = JSON.parse(await readFile('plan.json', 'utf8'));
  await preflight(opts, plan);
  console.log(describeHardware());
  await mkdir(path.dirname(opts.output), {recursive: true});

  const site = await serve();
  const browser = await chromium.launch({headless: true, args: browserArgs});
  let scratch = null;
  try {
    const {page, problems} = await openFilm(browser, site.url, plan);
    if (problems.length) throw new Error(problems.join('\n'));
    if (opts.still !== null) {
      await seekTo(page, opts.still);
      await page.screenshot({path: opts.output});
    } else {
      const from = opts.from;
      const to = opts.to ?? plan.duration;
      scratch = await mkdtemp(path.join(tmpdir(), 'film-frames-'));
      await captureFrames(page, plan, from, to, scratch);
      if (problems.length) throw new Error(problems.join('\n'));
      await encodeFrames(scratch, plan, opts, from, to);
    }
    console.log(opts.output);
  } finally {
    await browser?.close();
    await new Promise(resolve => site.server.close(resolve));
    if (scratch) await rm(scratch, {recursive: true, force: true});
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

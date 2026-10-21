// Film renderer. Opens the built film in headless Chromium, takes one screenshot per frame at exact film times,
// and hands the frames to ffmpeg. Options:
//   --output <file>     where to write (.mp4 for a film, .png for --still)
//   --audio <wav>       the verified master from mix-audio (required for a delivered film)
//   --still <seconds>   render one frame instead of the whole film
//   --from / --to      render only part of the film (no master needed for a partial render)
//   --jobs <n>          browser pages that capture frames in parallel (default 1; 4 is about 1.6x faster on 8 cores,
//                       but frames can differ by sub-pixel amounts from the single-page render, see README)
//   --silent-demo       technical test without audio; refused for a real plan
// Parallel capture: every chromium page is its own process, so the frame range is cut into contiguous slices and each
// slice gets its own browser context. Frames keep their global numbering, so ffmpeg sees one ordered sequence.
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserArgs, describeHardware, encodeArgs, run} from './pick-hardware.mjs';
import {serve} from './static-server.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readOptions(argv) {
  const opts = {output: 'renders/technical-demo.mp4', still: null, audio: null, from: 0, to: null, silentDemo: false, jobs: 1};
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
      case '--jobs': opts.jobs = Number(value()); break;
      case '--silent-demo': opts.silentDemo = true; break;
      default: throw new Error(`unknown option ${key}`);
    }
  }
  if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new Error('--jobs must be a whole number, 1 or more');
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

// Loads the film in its own context and collects anything that went wrong while it loaded.
async function openFilm(context, url) {
  const page = await context.newPage();
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
const newContext = (browser, plan) => browser.newContext({viewport: {width: plan.width, height: plan.height}, deviceScaleFactor: 1});

// Splits the frame range [first, last) into at most `jobs` contiguous slices of near-equal length.
function sliceFrames(first, last, jobs) {
  const count = last - first;
  const size = Math.ceil(count / Math.max(1, Math.min(jobs, count)));
  const slices = [];
  for (let start = first; start < last; start += size) slices.push([start, Math.min(last, start + size)]);
  return slices;
}

async function captureSlice(context, url, plan, [start, end], first, dir, tick) {
  const {page, problems} = await openFilm(context, url);
  if (problems.length) throw new Error(problems.join('\n'));
  for (let f = start; f < end; f++) {
    await seekTo(page, f / plan.fps);   // seek can await interactions such as clicks and popovers
    const name = `${String(f - first).padStart(6, '0')}.jpg`;
    await page.screenshot({path: path.join(dir, name), type: 'jpeg', quality: 95});
    tick();
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

async function captureFrames(browser, url, plan, from, to, dir, jobs) {
  const first = Math.round(from * plan.fps);
  const last = Math.round(to * plan.fps);
  const total = last - first;
  const slices = sliceFrames(first, last, jobs);
  const started = Date.now();
  let done = 0;
  const tick = () => {
    done += 1;
    if (done % 150 === 0 || done === total) {
      console.log(`frame ${done}/${total} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  };
  console.log(`capturing ${total} frames on ${slices.length} parallel page(s)`);
  const contexts = [];
  try {
    await Promise.all(slices.map(async slice => {
      const context = await newContext(browser, plan);
      contexts.push(context);
      await captureSlice(context, url, plan, slice, first, dir, tick);
    }));
  } finally {
    await Promise.all(contexts.map(context => context.close()));
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
    if (opts.still !== null) {
      const context = await newContext(browser, plan);
      const {page, problems} = await openFilm(context, site.url);
      if (problems.length) throw new Error(problems.join('\n'));
      await seekTo(page, opts.still);
      await page.screenshot({path: opts.output});
      await context.close();
    } else {
      const from = opts.from;
      const to = opts.to ?? plan.duration;
      scratch = await mkdtemp(path.join(tmpdir(), 'film-frames-'));
      await captureFrames(browser, site.url, plan, from, to, scratch, opts.jobs);
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

#!/usr/bin/env node
// openvideo-agent: turns a spec (copy + screenshots) into a finished product intro video, vertical and/or landscape.
//
//   node generate.mjs spec.json -o out                  write the video projects (out/vertical, out/landscape)
//   node generate.mjs spec.json -o out --run            ... and build, render, mix and narrate
//                                                       (needs Node, ffmpeg, bash; npm install for msedge-tts)
//   node generate.mjs spec.json -o out --aspect landscape
//
// See README.md for the spec format and examples/spec.example.json for a complete example.
import {spawnSync} from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import zlib from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASPECTS = {vertical: [1080, 1920], landscape: [1920, 1080]};
const KIND_THEME = {title: 'dark', cards: 'dark', terminal: 'dark', screenshot: 'light', end: 'dark'};
const SFX_GAIN = {typing: 0.6, success: 0.7, pop: 0.8, click: 0.8, resolve: 0.7};

class SpecError extends Error {}
const die = message => {
  throw new SpecError(message);
};
const isFile = file => existsSync(file) && statSync(file).isFile();

// Rounds halves to even (banker's rounding), so cue times stay on the same grid as before.
function roundHalfEven(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Actions that drive sound cues sit on the 0.5 s beat grid.
const snap = x => roundHalfEven(x * 2) / 2;

function validate(spec) {
  const shots = spec.shots?.length ? spec.shots : die('spec.shots is empty');
  if (shots[0].kind !== 'title') die('the first shot must have kind "title" (the intro)');
  if (shots[shots.length - 1].kind !== 'end') die('the last shot must have kind "end"');
  const seen = new Set();
  for (const s of shots) {
    for (const key of ['id', 'kind', 'seconds', 'headlineEn', 'headline', 'description', 'narration']) {
      if (!(key in s)) die(`shot ${s.id ?? '?'}: missing "${key}"`);
    }
    if (!/^[a-z0-9-]+$/.test(s.id) || seen.has(s.id)) {
      die(`shot id "${s.id}" must be unique, lowercase letters/digits/hyphens`);
    }
    seen.add(s.id);
    if (!Object.hasOwn(KIND_THEME, s.kind)) {
      die(`shot ${s.id}: unknown kind "${s.kind}" (use ${Object.keys(KIND_THEME).join(', ')})`);
    }
    if (s.seconds % 2 || s.seconds < 4) {
      die(`shot ${s.id}: seconds must be an even number >= 4 (shot cuts sit on 2 s bar lines)`);
    }
    const limit = Math.max(14, Math.trunc(s.seconds * 3.4));
    const chars = Array.from(s.narration).length;   // count code points, not UTF-16 units
    if (chars > limit) {
      console.log(`warning: shot ${s.id}: narration is ${chars} chars, about ${limit} fit in ${s.seconds} s`);
    }
    if (s.kind === 'screenshot' && !('image' in s)) die(`shot ${s.id}: screenshot needs "image"`);
    if (s.kind === 'cards' && !s.cards?.length) die(`shot ${s.id}: cards needs "cards"`);
  }
}

function checkPrivacy(spec, terms) {
  if (!terms.length) return;
  const blob = JSON.stringify(spec).toLowerCase();
  const hits = terms.filter(term => blob.includes(term.toLowerCase()));
  if (hits.length) {
    die(`privacy_terms found in the spec: [${hits.map(h => `'${h}'`).join(', ')}]. ` +
      'Remove them or they would appear in the video.');
  }
}

// Per-kind action times (seconds from shot start) and the sound cues they drive.
function actionsFor(s) {
  const kind = s.kind;
  const sec = s.seconds;
  const acts = [];
  const cues = [];
  const act = (name, at, sound = null) => {
    acts.push({id: `${s.id}-${name}`, at, action: name, soundRequired: Boolean(sound)});
    if (sound) cues.push([`${s.id}-${name}`, at, sound]);
  };
  if (kind === 'title') {
    act('enter', 0);
  } else if (kind === 'cards') {
    act('enter', 0.5);
    if (s.note) act('note', 3.0);
  } else if (kind === 'terminal') {
    const panes = s.panes ?? [];
    const done = snap(sec - 1.5);
    if (s.command) act('cmd', 0.5, 'typing');
    const first = s.command ? 2.0 : 0.5;
    for (let i = 0; i < panes.length; i++) {
      const span = Math.max(done - 1.5 - first, 1.0);
      act(`p${i}`, snap(first + (panes.length > 1 ? (i * span) / (panes.length - 1) : 0)));
    }
    if (s.qr) act('qr', 2.0, 'pop');
    if (s.phone) {
      act('phone', s.qr ? 3.5 : 2.0);
      if (s.phone.ring) act('ring', snap(sec - 4), 'click');
    }
    if (s.done) act('done', done, 'success');
    else if (s.footer && !s.qr) act('done', done);
  } else if (kind === 'screenshot') {
    act('enter', 0.5, 'pop');
    if (s.ring) act('ring', snap(sec - 2));
  } else if (kind === 'end') {
    act('enter', 0.5, 'resolve');
  }
  return {acts, cues};
}

const CONTENT_EXCLUDED = ['narration', 'seconds', 'image', 'phone', 'headlineEn', 'headline', 'description'];

function buildPlan(spec, w, h, copyMedia) {
  let t = 0;
  const shots = [];
  const content = [];
  const cues = [];
  for (const s of spec.shots) {
    const {acts, cues: shotCues} = actionsFor(s);
    const start = t;
    const end = t + s.seconds;
    shots.push({
      id: s.id, start, end,
      type: s.kind === 'title' ? 'title' : s.kind === 'end' ? 'end' : 'detail',
      headlineEn: s.headlineEn, headline: s.headline, description: s.description,
      descriptionAt: s.kind === 'title' ? 1.2 : s.kind === 'end' ? 2.0 : 1.0,
      claim: false, source: [], plainExplanation: s.description, actions: acts,
      component: 'src/shots/product.jsx',
    });
    for (const [actionId, at, sound] of shotCues) {
      cues.push({
        at: start + at, actionId, file: `assets/sfx/${sound}.wav`, gain: SFX_GAIN[sound], role: 'sfx',
        kind: sound, syncOffset: 0.0, onBeat: true,
      });
    }
    const c = Object.fromEntries(Object.entries(s).filter(([key]) => !CONTENT_EXCLUDED.includes(key)));
    c.kind = s.kind;
    c.theme = 'theme' in s ? s.theme : KIND_THEME[s.kind];
    if ('image' in s) c.image = {src: copyMedia(s.image)};
    if (s.phone) c.phone = {src: copyMedia(s.phone.image), ring: s.phone.ring ?? null};
    content.push(c);
    t = end;
  }
  const plan = {
    demo: false,
    product: spec.product ?? spec.name ?? 'product',
    scope: {
      versions: spec.version ?? '',
      platforms: spec.platforms ?? [],
      notCovered: spec.notCovered ?? [],
    },
    repo: '.', style: 'default', width: w, height: h, fps: 30, duration: t,
    audioRequired: true, sfxRequired: true,
    typography: {
      mode: 'bilingual', zhFont: 'Microsoft YaHei / PingFang SC / Noto Sans CJK SC',
      enFont: 'Georgia', zhStyle: 'sans-serif',
    },
    audio: {
      beatGrid: {bpm: 120, offset: 0},
      ducking: {enabled: true},
      music: {file: 'assets/music.wav', gain: spec.music_gain ?? 0.5},
      cues,
    },
    shots,
  };
  return {plan, content: {shots: content}};
}

// PNG CRC-32, computed here so the script needs no zlib.crc32 (Node 22.2+).
const CRC_TABLE = Array.from({length: 256}, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(tag, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tag, 'latin1'), data])));
  return Buffer.concat([length, Buffer.from(tag, 'latin1'), data, crc]);
}

// One dark pixel; replaced by the real first-frame poster on --run.
function blankPng(file) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);   // width
  ihdr.writeUInt32BE(1, 4);   // height
  ihdr[8] = 8;                // bit depth
  ihdr[9] = 2;                // colour type: RGB
  const raw = Buffer.from([0x00, 0x0b, 0x10, 0x20]);   // filter byte + one RGB pixel
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

function writeProject(spec, specDir, out, aspect) {
  const [w, h] = ASPECTS[aspect];
  if (existsSync(out) && readdirSync(out).length) {
    // regenerate in place; keep node_modules and renders
    for (const sub of ['src', 'public', 'plan.json']) rmSync(path.join(out, sub), {recursive: true, force: true});
  }
  mkdirSync(out, {recursive: true});
  cpSync(path.join(HERE, 'engine'), out, {
    recursive: true,
    filter: src => !['node_modules', 'dist'].includes(path.basename(src)),
  });
  mkdirSync(path.join(out, 'public', 'shots'), {recursive: true});
  for (const sub of ['assets/music', 'evidence', 'renders', 'src/shots']) {
    mkdirSync(path.join(out, sub), {recursive: true});
  }

  const copyMedia = rel => {
    const src = path.resolve(specDir, rel);
    if (!isFile(src)) die(`media file not found: ${src}`);
    copyFileSync(src, path.join(out, 'public', 'shots', path.basename(src)));
    return `shots/${path.basename(src)}`;
  };

  const {plan, content} = buildPlan(spec, w, h, copyMedia);
  writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(path.join(out, 'src', 'spec.json'), JSON.stringify(content, null, 2));
  copyFileSync(path.join(HERE, 'templates', `film.${aspect}.css`), path.join(out, 'src', 'film.css'));
  copyFileSync(path.join(HERE, 'templates', 'film.jsx'), path.join(out, 'src', 'film.jsx'));
  copyFileSync(path.join(HERE, 'templates', 'product.jsx'), path.join(out, 'src', 'shots', 'product.jsx'));
  copyFileSync(path.join(HERE, 'templates', 'index.js'), path.join(out, 'src', 'shots', 'index.js'));
  blankPng(path.join(out, 'public', 'poster.png'));

  const narration = {
    voice: spec.voice ?? 'zh-CN-XiaoxiaoNeural',
    rate: spec.rate ?? '+5%',
    lines: Object.fromEntries(spec.shots.map(s => [s.id, s.narration])),
  };
  writeFileSync(path.join(out, 'narration.json'), JSON.stringify(narration, null, 2));

  const terms = spec.privacy_terms ?? [];
  if (terms.length) writeFileSync(path.join(out, '.privacy-terms'), terms.join('\n') + '\n');

  const musicStyle = spec.music ?? 'soft-marimba';
  const style = path.join(HERE, 'templates', 'music', `${musicStyle}.mjs`);
  if (!isFile(style)) die(`unknown music style "${musicStyle}"; see templates/music/README.md`);
  copyFileSync(style, path.join(out, 'assets', 'music', 'make-music.mjs'));
  copyFileSync(path.join(HERE, 'templates', 'music', 'audio-kit.mjs'), path.join(out, 'assets', 'music', 'audio-kit.mjs'));
  const music = spawnSync(process.execPath, ['assets/music/make-music.mjs', 'assets/music.wav', 'plan.json'],
    {cwd: out, stdio: 'inherit', env: process.env});
  if (music.status !== 0) die('music generation failed (make-music.mjs)');

  console.log(`${aspect}: wrote ${out} (${plan.duration} s, ${plan.shots.length} shots)`);
  return plan;
}

function findBash() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const found = spawnSync(finder, ['bash'], {encoding: 'utf8'});
  return found.status === 0 ? found.stdout.split(/\r?\n/)[0].trim() : null;
}

function runProject(out) {
  const sh = command => {
    const result = spawnSync(command, {cwd: out, shell: true, stdio: 'inherit', env: process.env});
    if (result.status !== 0) die(`command failed: ${command}`);
  };
  if (!existsSync(path.join(out, 'node_modules'))) {
    sh('npm install');
    sh('npx playwright install chromium --only-shell');
  }
  sh('npm run build');
  const posterDir = path.join(out, 'evidence', 'poster');
  rmSync(posterDir, {recursive: true, force: true});
  sh('node capture-stills.mjs evidence/poster 3.5');
  const poster = readdirSync(posterDir).find(name => name.endsWith('.png')) ?? die('no poster frame was captured');
  // the first frame of the finished intro is the poster that covers the film's blank first frame
  copyFileSync(path.join(posterDir, poster), path.join(out, 'public', 'poster.png'));

  const bash = findBash() ?? die('bash not found (on Windows install Git for Windows)');
  const pipeline = spawnSync(bash, [path.join(HERE, 'scripts', 'pipeline.sh'), out], {stdio: 'inherit', env: process.env});
  if (pipeline.status !== 0) die('scripts/pipeline.sh failed');
}

function main() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      out: {type: 'string', short: 'o'},
      aspect: {type: 'string', default: 'both'},
      run: {type: 'boolean', default: false},
    },
  });
  const [specArg] = positionals;
  if (!specArg || !values.out) die('usage: node generate.mjs spec.json -o out [--aspect vertical|landscape|both] [--run]');
  if (!['vertical', 'landscape', 'both'].includes(values.aspect)) die('--aspect must be vertical, landscape or both');

  const specPath = path.resolve(specArg);
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  validate(spec);
  checkPrivacy(spec, spec.privacy_terms ?? []);

  const out = path.resolve(values.out);
  const aspects = values.aspect === 'both' ? Object.keys(ASPECTS) : [values.aspect];
  for (const aspect of aspects) {
    writeProject(spec, path.dirname(specPath), path.join(out, aspect), aspect);
    if (values.run) {
      runProject(path.join(out, aspect));
      console.log(`${aspect}: final video -> ${path.join(out, aspect, 'renders', 'final-narrated-sub.mp4')}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}

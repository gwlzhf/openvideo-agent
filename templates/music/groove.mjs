// Style: groove. A rhythmic bed for the install video: the Bounce drum kit (CC0 one-shots in assets/drums/bounce)
// carries the beat, a bouncy sine bass and a bright pluck hook sit on top. 120 BPM (bar = 2 s, 16 steps of 1/8 s),
// 4-bar loop Am - F - C - G. Every shot start in plan.json gets a cymbal hit, so the cuts land on the groove.
// Reads duration and cut points from plan.json. Fades in 0.05 s, out 3 s.
// Usage: node make-groove.mjs <out.wav> [plan.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {encodeWav, fade, generate, hz, place} from './audio-kit.mjs';

const SR = 44100;
const BAR = 2.0;
const STEP = BAR / 16;
const DRUMS = 'assets/drums/bounce';

// 16-bit mono PCM only (the Bounce kit is 44.1 kHz mono); anything else is rejected rather than resampled
function readWav(file) {
  const buf = readFileSync(file);
  let at = 12;
  let fmt = null;
  let data = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = {channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22)};
    if (id === 'data') data = buf.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.rate !== SR) throw new Error(`${file}: expected 16-bit ${SR} Hz PCM`);
  const frames = data.length / (2 * fmt.channels);
  return Float64Array.from({length: frames}, (_, i) => {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2);
    return sum / fmt.channels / 32768;
  });
}

const samples = new Map();
const sample = (name, gain) => {
  if (!samples.has(name)) samples.set(name, readWav(`${DRUMS}/${name}`));
  return samples.get(name).map(x => x * gain);
};

// bouncy bass: sine with a soft 2nd partial, quick decay, short gate
function bass(f, vel, length = 0.22) {
  return generate(length, SR, (t) => {
    const w = Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t);
    return vel * w * Math.exp(-t * 6) * Math.min(t / 0.004, 1) * Math.min((length - t) / 0.02, 1);
  });
}

// bright pluck: three partials that die at different rates, so the attack is clear and the tail is soft
function pluck(f, vel) {
  return generate(0.35, SR, (t) => {
    const w = Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t);
    return vel * w * Math.exp(-t * 9) * Math.min(t / 0.003, 1);
  });
}

// stereo put: pan 0 = left, 1 = right
function putStereo(buf, at, signal, pan = 0.5) {
  place(buf[0], at, signal.map(x => x * (1 - pan)), SR);
  place(buf[1], at, signal.map(x => x * pan), SR);
}

// 4-bar loop. Hook: step (16ths) -> MIDI note. Bass: root for the bar, in octave 1-2.
const BARS = [
  {name: 'Am', bass: 33, hook: [[0, 69], [3, 72], [6, 76], [8, 72], [10, 69], [12, 72], [14, 76]]},
  {name: 'F', bass: 29, hook: [[0, 65], [3, 69], [6, 72], [8, 69], [10, 65], [12, 69], [14, 72]]},
  {name: 'C', bass: 36, hook: [[0, 67], [3, 72], [6, 76], [8, 72], [10, 67], [12, 64], [14, 67]]},
  {name: 'G', bass: 31, hook: [[0, 67], [3, 71], [6, 74], [8, 71], [10, 67], [12, 62], [14, 67]]},
];
const KICK_STEPS = [0, 6, 8, 14];
const SNARE_STEPS = [4, 12];
const BASS_STEPS = [0, 3, 6, 8, 10, 14];

function main(out, planPath) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const dur = Number(plan.duration);
  const cuts = plan.shots.slice(1).map(s => Number(s.start));
  const size = Math.round((dur + 2) * SR);
  const buf = [new Float64Array(size), new Float64Array(size)];
  const bars = Math.ceil(dur / BAR);

  for (let b = 0; b < bars; b++) {
    const t0 = b * BAR;
    const bar = BARS[b % BARS.length];
    const variant = b % 2;   // alternate snare sample every bar for a little movement
    for (const s of KICK_STEPS) putStereo(buf, t0 + s * STEP, sample(`bounce-kick-0${1 + (b % 3)}.wav`, 0.8), 0.5);
    for (const s of SNARE_STEPS) putStereo(buf, t0 + s * STEP, sample(`bounce-snare-0${1 + variant}.wav`, 0.55), 0.5);
    for (let s = 0; s < 16; s += 2) putStereo(buf, t0 + s * STEP, sample('hi-hat-closed-01.wav', s % 4 ? 0.22 : 0.32), 0.62);
    putStereo(buf, t0 + 14 * STEP, sample('open-hat-01.wav', 0.25), 0.4);
    for (const s of BASS_STEPS) putStereo(buf, t0 + s * STEP, bass(hz(bar.bass + 12), 0.34), 0.5);
    for (const [s, midi] of bar.hook) putStereo(buf, t0 + s * STEP, pluck(hz(midi), 0.2), 0.55);
  }

  // every shot change: cymbal swell on the downbeat, so the cut reads as a beat
  for (const c of cuts) putStereo(buf, c, sample('fx-cymbal.wav', 0.5), 0.5);

  const n = Math.round(dur * SR);
  const fo = Math.round(3 * SR);
  const channels = buf.map(channel => {
    const body = fade(channel.slice(0, n), SR, 0.05, 0);
    for (let i = 0; i < fo; i++) body[n - fo + i] *= 1 - i / fo;   // linear fade-out over the last 3 s
    return body;
  });
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  writeFileSync(out, encodeWav(channels.map(channel => channel.map(x => (x / peak) * 0.8)), SR));
  console.log(`wrote ${out}: ${dur}s, 120 BPM, groove on Bounce kit, cut points ${JSON.stringify(cuts)}`);
}

main(process.argv[2] ?? 'assets/music.wav', process.argv[3] ?? 'plan.json');

// Style: douyin-bounce. Short-video background music: catchy plucked hook, bouncy bass, four-on-the-floor kick,
// off-beat hats. Beat-synced to the film: 120 BPM (beat 0.5 s, bar 2 s); every shot start in plan.json gets a riser
// in the bar before it, a short stop-time gap, then an impact on the downbeat (the cut points).
// Usage: node make-music.mjs <out.wav> [plan.json]   (no dependencies; length and cut points come from plan.json)
import {readFileSync, writeFileSync} from 'node:fs';
import {encodeWav, gaussian, generate, hz, normalize, place, rng} from './audio-kit.mjs';

const SR = 44100;
const BEAT = 0.5;
const STEP = BEAT / 4;   // 16th note
const normal = (() => {
  const uniform = rng(7);
  return () => gaussian(uniform);
})();

// 4-bar loop: C - G - Am - F. Each bar: chord triad, bass root, and the 16-step hook (step: MIDI note)
const BARS = [
  {chord: [60, 64, 67], bass: 36, hook: {0: 76, 3: 76, 5: 79, 7: 76, 9: 74, 11: 72, 14: 74}},
  {chord: [59, 62, 67], bass: 31, hook: {0: 74, 3: 74, 5: 76, 7: 74, 9: 71, 11: 67, 14: 71}},
  {chord: [57, 60, 64], bass: 33, hook: {0: 76, 3: 76, 5: 81, 7: 76, 9: 72, 11: 69, 14: 72}},
  {chord: [57, 60, 65], bass: 29, hook: {0: 72, 3: 72, 5: 77, 7: 72, 9: 69, 11: 65, 14: 67}},
];

const tt = n => Array.from({length: n}, (_, i) => i / SR);
const sine = (f, t) => Math.sin(2 * Math.PI * f * t);
const ramp = (t, a) => Math.min(t / a, 1);

// first difference with a leading zero (x[i] - x[i-1], with x[-1] = 0)
function diff(x) {
  return x.map((v, i) => (i === 0 ? v : v - x[i - 1]));
}
const noise = n => Array.from({length: n}, () => normal());

function pluck(f, length, vel) {
  return generate(length, SR, (t) => {
    let w = 0;
    for (const d of [0.997, 1.003]) {   // slight detune = chorus
      for (let k = 1; k < 8; k++) w += sine(f * d * k, t) / k;
    }
    return vel * w * Math.exp(-t * 11) * ramp(t, 0.003);
  });
}

function bass(f, length, vel) {
  return generate(length, SR, (t) => {
    const w = sine(f, t) + 0.35 * sine(2 * f, t);
    return vel * w * Math.exp(-t * 5) * ramp(t, 0.004) * Math.min(Math.max((length - t) / 0.03, 0), 1);
  });
}

function stab(freqs, length, vel) {
  return generate(length, SR, (t) => {
    let w = 0;
    for (const f of freqs) w += Math.sign(sine(f, t)) * 0.3 + sine(f, t);
    return vel * w * Math.exp(-t * 16) * ramp(t, 0.003);
  });
}

function kick(vel) {
  const n = Math.round(0.28 * SR);
  const freq = Array.from({length: n}, (_, i) => 45 + 110 * Math.exp((-i / SR) * 30));
  let phase = 0;
  return Float64Array.from({length: n}, (_, i) => {
    phase += freq[i] / SR;   // running sum of the frequency curve
    return vel * Math.sin(2 * Math.PI * phase) * Math.exp((-i / SR) * 13);
  });
}

function hat(vel, length = 0.06) {
  const x = diff(noise(Math.round(length * SR)));
  return Float64Array.from(x, (v, i) => vel * v * Math.exp((-i / SR) * 70));
}

function clap(vel) {
  const n = Math.round(0.18 * SR);
  const x = diff(noise(n));
  const env = Float64Array.from({length: n}, (_, i) => Math.exp((-i / SR) * 28));
  for (const off of [0.012, 0.024]) {
    const shift = Math.round(off * SR);
    for (let i = 0; i < n; i++) env[i] += 0.6 * Math.exp((-((i - shift + n) % n) / SR) * 28);   // circular, like np.roll
  }
  return Float64Array.from({length: n}, (_, i) => vel * x[i] * env[i] * 0.7);
}

function riser(length, vel) {
  const n = Math.round(length * SR);
  const x = diff(noise(n));
  return Float64Array.from({length: n}, (_, i) => {
    const t = i / SR;
    const u = t / length;
    const shaped = x[i] * (0.4 + 2.0 * u) * u ** 2;
    return vel * shaped + vel * 0.3 * sine(300 + 1500 * u ** 2, t) * u ** 3;
  });
}

function impact(vel) {
  const n = Math.round(1.4 * SR);
  const crash = diff(noise(n));
  return Float64Array.from({length: n}, (_, i) => {
    const t = i / SR;
    const boom = sine(48 + 60 * Math.exp(-t * 9), t) * Math.exp(-t * 3.2);
    return vel * (boom + crash[i] * Math.exp(-t * 4.5) * 0.5);
  });
}

// stereo put: pan 0 = left, 1 = right
function putStereo(buf, at, signal, pan = 0.5) {
  place(buf[0], at, signal.map(x => x * (1 - pan)), SR);
  place(buf[1], at, signal.map(x => x * pan), SR);
}

function main(out, planPath) {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const dur = Number(plan.duration);
  const cuts = plan.shots.slice(1).map(s => Number(s.start));
  const size = Math.round((dur + 2) * SR);
  const buf = [new Float64Array(size), new Float64Array(size)];
  const harm = [new Float64Array(size), new Float64Array(size)];
  const bars = Math.ceil(dur / (4 * BEAT));

  // side-chain: the harmony and bass dip on every kick
  const duck = new Float64Array(size).fill(1);
  const pump = tt(Math.round(BEAT * SR)).map(t => 1 - 0.55 * Math.exp(-t * 9));
  for (let k = 0; k < dur + 1; k += BEAT) {
    const i = Math.round(k * SR);
    for (let j = 0; j < pump.length && i + j < size; j++) duck[i + j] = Math.min(duck[i + j], pump[j]);
  }

  const lastStart = cuts.length ? cuts[cuts.length - 1] : dur;
  for (let b = 0; b < bars; b++) {
    const t0 = b * 4 * BEAT;
    const bar = BARS[b % 4];
    const inLast = t0 >= lastStart;
    for (const [s, m] of Object.entries(bar.hook)) putStereo(buf, t0 + Number(s) * STEP, pluck(hz(m), 0.22, 0.30), 0.55);
    for (const s of [2, 6, 10, 14]) putStereo(harm, t0 + s * STEP, stab(bar.chord.map(hz), 0.16, 0.05), 0.4);
    for (const [s, octUp] of [[0, 0], [3, 0], [6, 12], [8, 0], [11, 0], [14, 12]]) {
      putStereo(harm, t0 + s * STEP, bass(hz(bar.bass + 12 + octUp), 0.2, 0.30), 0.5);
    }
    for (const s of [0, 4, 8, 12]) putStereo(buf, t0 + s * STEP, kick(inLast ? 0.4 : 0.55), 0.5);
    if (t0 >= 8 && !inLast) for (const s of [4, 12]) putStereo(buf, t0 + s * STEP, clap(0.22), 0.5);
    if (!inLast) {
      for (const s of [2, 6, 10, 14]) putStereo(buf, t0 + s * STEP, hat(0.16), s % 4 ? 0.65 : 0.35);
      for (let s = 1; s < 16; s += 2) putStereo(buf, t0 + s * STEP, hat(0.04, 0.03), 0.3 + 0.4 * (s % 4 === 1 ? 1 : 0));
    }
  }
  for (const c of [0, 1]) for (let i = 0; i < size; i++) buf[c][i] += harm[c][i] * duck[i];

  // cut points: stop-time gap just before the downbeat, riser through the bar before, impact on the cut
  for (const c of cuts) {
    const i0 = Math.round((c - STEP) * SR);
    const i1 = Math.round(c * SR);
    for (const channel of buf) for (let i = Math.max(0, i0); i < Math.min(i1, size); i++) channel[i] *= 0.15;
    putStereo(buf, c - 4 * BEAT, riser(4 * BEAT, 0.07), 0.5);
    for (let n = 0; n < 4; n++) putStereo(buf, c - 4 * STEP + n * STEP, clap(0.10 + 0.05 * n), 0.5);
    putStereo(buf, c, impact(0.55), 0.5);
    putStereo(buf, c, pluck(hz(84), 0.5, 0.18), 0.5);
  }

  const n = Math.round(dur * SR);
  const channels = buf.map(channel => channel.slice(0, n));
  const fo = Math.round(2.5 * SR);
  for (const channel of channels) {
    for (let i = 0; i < fo; i++) channel[n - fo + i] *= 1 - i / fo;   // linspace(1, 0, fo) on the tail
  }
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  const scaled = channels.map(channel => channel.map(x => (x / peak) * 0.85));
  writeFileSync(out, encodeWav(scaled, SR));
  console.log(`wrote ${out}: ${dur}s, 120 BPM, cut points ${JSON.stringify(cuts)}`);
}

main(process.argv[2] ?? 'assets/music.wav', process.argv[3] ?? 'plan.json');

// Style: ethnic-pentatonic. A Chinese minority-flavoured bed built only from the A minor pentatonic (A C D E G), so
// every note is consonant with every other: a sparse plucked-string arpeggio (lute-like), a breathy bamboo-flute line
// with vibrato, and a soft horse-fiddle drone. No drums, no risers; it stays out of the narrator's way.
// 120 BPM (bar = 2 s), Am - Gsus4 - Dsus2 - C. Reads duration from plan.json; fades in 0.8 s / out 3 s.
// Usage: node make-music.mjs <out.wav> [plan.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {encodeWav, fade, generate, hz, lowpass, place, rng} from './audio-kit.mjs';

const SR = 44100;
const BAR = 2.0;
const S8 = BAR / 8;   // eighth note
const uniform = rng(7);   // fixed seed: the same plan always gives the same file
const breath = () => 2 * uniform() - 1;

// lute chord tones (MIDI), drone root (MIDI), flute line as [8th-note step, MIDI, length in 8ths]
const ARP = [0, null, 1, 2, null, 1, 0, null];   // index into the chord, null = rest
const BARS = [
  {chord: [57, 60, 64], drone: 45, flute: [[0, 69, 3], [4, 72, 2], [6, 69, 2]]},   // Am
  {chord: [55, 60, 62], drone: 43, flute: [[0, 67, 2], [2, 72, 2], [4, 74, 4]]},   // Gsus4
  {chord: [50, 52, 57], drone: 38, flute: [[0, 74, 2], [2, 76, 2], [4, 69, 4]]},   // Dsus2
  {chord: [52, 55, 60], drone: 48, flute: [[0, 72, 2], [2, 67, 2], [4, 64, 4]]},   // C
];

// plucked string: decaying harmonics, the higher ones die faster, with a tiny click at the attack
function pluck(f, vel, length = 0.9) {
  const amplitudes = [1.0, 0.45, 0.2, 0.08];
  return generate(length, SR, (t) => {
    let w = 0;
    amplitudes.forEach((a, i) => {
      const k = i + 1;
      w += a * Math.sin(2 * Math.PI * f * k * t) * Math.exp(-t * (1.6 + 3.0 * k));
    });
    w += 0.12 * breath() * Math.exp(-t * 120);
    return vel * w * Math.min(t / 0.002, 1);
  });
}

// breathy flute: sine with 2nd and 3rd harmonics, 5.5 Hz vibrato (the phase is integrated, so no clicks), breath noise
function flute(f, vel, length) {
  let phase = 0;
  return Float64Array.from({length: Math.round(length * SR)}, (_, i) => {
    const t = i / SR;
    phase += 2 * Math.PI * f * (1 + 0.005 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(t / 0.4, 1)) / SR;
    const tone = Math.sin(phase) + 0.12 * Math.sin(2 * phase) + 0.03 * Math.sin(3 * phase) + 0.03 * breath();
    const env = Math.min(t / 0.07, 1) * Math.min(Math.max(length - t, 0) / 0.15, 1);
    return vel * tone * env;
  });
}

// horse-fiddle style drone: soft root, a strong 2nd partial, slow shallow vibrato
function drone(f, vel, length) {
  let phase = 0;
  return Float64Array.from({length: Math.round(length * SR)}, (_, i) => {
    const t = i / SR;
    phase += 2 * Math.PI * f * (1 + 0.003 * Math.sin(2 * Math.PI * 4.2 * t)) / SR;
    const tone = Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    const env = Math.min(t / 0.6, 1) * Math.min(Math.max(length - t, 0) / 0.6, 1);
    return vel * tone * env;
  });
}

// stereo placement: pan 0 = left, 1 = right
function putStereo(buf, at, signal, pan) {
  place(buf[0], at, signal.map(x => x * (1 - pan)), SR);
  place(buf[1], at, signal.map(x => x * pan), SR);
}

function main(out, planPath) {
  const dur = Number(JSON.parse(readFileSync(planPath, 'utf8')).duration);
  const size = Math.round((dur + 2) * SR);
  const buf = [new Float64Array(size), new Float64Array(size)];
  for (let b = 0; b < Math.ceil(dur / BAR); b++) {
    const t0 = b * BAR;
    const bar = BARS[b % 4];
    putStereo(buf, t0, drone(hz(bar.drone), 0.06, BAR + 0.6), 0.5);
    putStereo(buf, t0, drone(hz(bar.drone + 7), 0.025, BAR + 0.6), 0.5);   // quiet fifth above the root
    ARP.forEach((idx, k) => {
      if (idx === null) return;
      putStereo(buf, t0 + k * S8, pluck(hz(bar.chord[idx]), 0.10), 0.3 + 0.1 * idx);
    });
    for (const [step, midi, eighths] of bar.flute) {
      putStereo(buf, t0 + step * S8, flute(hz(midi), 0.14, eighths * S8 + 0.1), 0.66);
    }
  }
  const n = Math.round(dur * SR);
  // high-cut so the flute breath never sparkles over the voice
  const [left, right] = buf.map(channel => lowpass(channel.subarray(0, n), 3200, SR));
  const channels = [fade(left, SR, 0.8, 3), fade(right, SR, 0.8, 3)];
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  writeFileSync(out, encodeWav(channels.map(channel => channel.map(x => (x / peak) * 0.7)), SR));
  console.log(`wrote ${out}: ${dur}s, 120 BPM, ethnic pentatonic`);
}

main(process.argv[2] ?? 'assets/music.wav', process.argv[3] ?? 'plan.json');

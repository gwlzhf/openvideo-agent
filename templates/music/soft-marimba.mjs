// Style: soft-marimba. Light, calm marimba bed that stays out of the narrator's way: no drums, no risers,
// sparse 8th-note arpeggio in a low-mid register, a few melody notes, soft bass, gentle high-cut.
// 120 BPM (bar = 2 s), Cmaj7 - Am7 - Fmaj7 - G6. Reads duration from plan.json; fades in 0.8 s / out 3 s.
// Usage: node make-music.mjs <out.wav> [plan.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {encodeWav, fade, generate, hz, lowpass, place} from './audio-kit.mjs';

const SR = 44100;
const BAR = 2.0;
const S8 = BAR / 8;   // eighth note

// chord tones (MIDI), bass root, arpeggio order (8th-note steps, null = rest), melody (step, MIDI)
const ARP = [0, null, 2, 1, null, 3, 2, null];
const BARS = [
  {ch: [60, 64, 67, 71], bass: 48, mel: [[4, 76], [6, 72]]},          // Cmaj7
  {ch: [57, 60, 64, 67], bass: 45, mel: [[2, 72], [5, 76]]},          // Am7
  {ch: [53, 57, 60, 64], bass: 41, mel: [[4, 72], [6, 69]]},          // Fmaj7
  {ch: [55, 59, 62, 64], bass: 43, mel: [[2, 74], [4, 71], [6, 74]]}, // G6
];

function marimba(f, vel, length = 1.4) {
  const decay = 4.0 + f / 250;   // lower notes ring longer
  return generate(length, SR, (t) => {
    const partials = Math.sin(2 * Math.PI * f * t)
      + 0.35 * Math.sin(2 * Math.PI * 3.93 * f * t) * Math.exp(-t * 22)
      + 0.10 * Math.sin(2 * Math.PI * 9.2 * f * t) * Math.exp(-t * 40);
    return vel * partials * Math.exp(-t * decay) * Math.min(t / 0.002, 1);
  });
}

// pan: 0 = left, 1 = right
function putStereo(buf, at, signal, pan) {
  place(buf[0], at, signal.map(x => x * (1 - pan)), SR);
  place(buf[1], at, signal.map(x => x * pan), SR);
}

function main(out, planPath) {
  const dur = Number(JSON.parse(readFileSync(planPath, 'utf8')).duration);
  const buf = [new Float64Array(Math.round((dur + 2) * SR)), new Float64Array(Math.round((dur + 2) * SR))];
  for (let b = 0; b < Math.ceil(dur / BAR); b++) {
    const t0 = b * BAR;
    const bar = BARS[b % 4];
    putStereo(buf, t0, marimba(hz(bar.bass), 0.20, 1.8), 0.5);
    putStereo(buf, t0 + 4 * S8, marimba(hz(bar.bass), 0.09, 1.0), 0.5);
    ARP.forEach((idx, k) => {
      if (idx === null) return;
      putStereo(buf, t0 + k * S8, marimba(hz(bar.ch[idx] + (idx > 1 ? 12 : 0)), 0.11, 1.0), 0.35 + 0.05 * idx);
    });
    for (const [step, midi] of bar.mel) putStereo(buf, t0 + step * S8, marimba(hz(midi), 0.17, 1.4), 0.62);
  }
  const n = Math.round(dur * SR);
  // gentle high-cut so nothing sparkles over the voice
  const [left, right] = buf.map(channel => lowpass(channel.subarray(0, n), 2800, SR));
  const channels = [fade(left, SR, 0.8, 3), fade(right, SR, 0.8, 3)];
  // one common gain keeps the stereo balance
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  const gain = (0.7 / peak);
  const scaled = channels.map(channel => channel.map(x => x * gain));
  writeFileSync(out, encodeWav(scaled, SR));
  console.log(`wrote ${out}: ${dur}s, 120 BPM, soft marimba`);
}

main(process.argv[2] ?? 'assets/music.wav', process.argv[3] ?? 'plan.json');

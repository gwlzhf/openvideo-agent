// Style: ode-to-joy. Beethoven's "Ode to Joy" (public domain), synthesised: soft piano-like lead, arpeggio
// accompaniment, light bass. Calm, recognisable, not beat-cut. 120 BPM (bar = 2 s); theme loops, 3 s fade-out.
// Usage: node make-music.mjs <out.wav> [plan.json]
import {readFileSync, writeFileSync} from 'node:fs';
import {encodeWav, fade, generate, hz, place} from './audio-kit.mjs';

const SR = 44100;
const BEAT = 0.5;
const NOTE_OFFSET = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
const midi = (name, octave) => 12 * (octave + 1) + NOTE_OFFSET[name];
const E4 = midi('E', 4);
const F4 = midi('F', 4);
const G4 = midi('G', 4);
const D4 = midi('D', 4);
const C4 = midi('C', 4);
const G3 = midi('G', 3);

// melody as [midi, beats]
const PHRASE_A = [[E4, 1], [E4, 1], [F4, 1], [G4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1],
  [C4, 1], [C4, 1], [D4, 1], [E4, 1], [E4, 1.5], [D4, 0.5], [D4, 2]];
const PHRASE_B = [...PHRASE_A.slice(0, 12), [D4, 1.5], [C4, 0.5], [C4, 2]];
const PHRASE_C = [[D4, 1], [D4, 1], [E4, 1], [C4, 1], [D4, 1], [E4, 0.5], [F4, 0.5], [E4, 1], [C4, 1],
  [D4, 1], [E4, 0.5], [F4, 0.5], [E4, 1], [D4, 1], [C4, 1], [D4, 1], [G3, 2]];
const THEME = [...PHRASE_A, ...PHRASE_B, ...PHRASE_C, ...PHRASE_B];

const CHORDS = {C: [midi('C', 3), [0, 4, 7]], G: [midi('G', 2), [0, 4, 7]]};
const HARMONY = ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'C', 'G', 'G', 'G', 'C', 'C', 'G', 'C', 'C'];
const ARP_ORDER = [0, 1, 2, 1, 0, 1, 2, 1];

function tone(f, length, vel, bright = 1.0) {
  const partials = [[1, 1.0], [2, 0.35 * bright], [3, 0.15 * bright], [4, 0.06 * bright]];
  return generate(length, SR, (t) => {
    let w = 0;
    for (const [k, a] of partials) w += a * Math.sin(2 * Math.PI * f * k * t);
    return vel * w * Math.exp(-t * 2.6) * Math.min(t / 0.008, 1) * Math.min(Math.max((length - t) / 0.06, 0), 1);
  });
}

function main(out, planPath) {
  const dur = Number(JSON.parse(readFileSync(planPath, 'utf8')).duration);
  const total = Math.round((dur + 1) * SR);
  const left = new Float64Array(total);
  const right = new Float64Array(total);
  const themeBeats = THEME.reduce((sum, [, beats]) => sum + beats, 0);
  for (let rep = 0; rep < Math.ceil(dur / (themeBeats * BEAT)); rep++) {
    const t0 = rep * themeBeats * BEAT;
    let pos = 0;
    for (const [m, beats] of THEME) {
      const s = tone(hz(m), beats * BEAT * 1.15, 0.34);
      place(left, t0 + pos * BEAT, s.map(x => x * 0.9), SR);
      place(right, t0 + pos * BEAT, s, SR);
      pos += beats;
    }
    HARMONY.forEach((chord, bar) => {
      const [root, triad] = CHORDS[chord];
      const bt = t0 + bar * 4 * BEAT;
      const pad = tone(hz(root), 3.2 * BEAT, 0.30, 0.5);
      place(left, bt, pad, SR);
      place(right, bt, pad, SR);
      for (let k = 0; k < 8; k++) {
        const s = tone(hz(root + 12 + triad[ARP_ORDER[k]]), 1.2 * BEAT, 0.11, 0.6);
        place(left, bt + (k * BEAT) / 2, s.map(x => x * (0.7 + 0.04 * k)), SR);
        place(right, bt + (k * BEAT) / 2, s.map(x => x * (1.1 - 0.04 * k)), SR);
      }
    });
  }
  const n = Math.round(dur * SR);
  const channels = [fade(left.slice(0, n), SR, 1, 3), fade(right.slice(0, n), SR, 1, 3)];
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  const scaled = channels.map(channel => channel.map(x => (x * 0.8) / peak));
  writeFileSync(out, encodeWav(scaled, SR));
  console.log(`wrote ${out}: ${dur}s, 120 BPM, Ode to Joy`);
}

main(process.argv[2] ?? 'assets/music.wav', process.argv[3] ?? 'plan.json');

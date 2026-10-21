#!/usr/bin/env node
// Synthesises the eight sound effects that plan.json cues refer to (assets/sfx/<name>.wav).
// Everything here is generated from code: no recordings, no third-party sound files.
//   node scripts/make-sfx.mjs [outDir]        default outDir: engine/assets/sfx
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeWav, fade, gaussian, generate, highpass, normalize, place, rng} from '../templates/music/audio-kit.mjs';

const SR = 48000;
const PEAK = 0.5;   // about -6 dBFS; the mixer applies each cue's gain on top
const HERE = path.dirname(fileURLToPath(import.meta.url));

const tone = (f, t, decay) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * decay);
const seeded = seed => {
  const uniform = rng(seed);
  return () => gaussian(uniform);
};

// Bell-like partials: a fundamental with inharmonic overtones that decay faster.
function bell(f, t, decay) {
  return tone(f, t, decay) + 0.45 * tone(f * 2.76, t, decay * 1.8) + 0.2 * tone(f * 5.4, t, decay * 3.2);
}

const SOUNDS = {
  // short UI tick: a 2.2 kHz blip with a noisy transient
  click(noise) {
    return generate(0.16, SR, (t) => tone(2200, t, 120) * 0.8 + noise() * 0.3 * Math.exp(-t * 400));
  },

  // keyboard typing: four clacks, each a high-passed noise burst
  typing(noise) {
    const clack = () => highpass(generate(0.05, SR, (t) => noise() * Math.exp(-t * 110)), 1800, SR);
    const out = new Float64Array(Math.round(0.65 * SR));
    for (const at of [0, 0.11, 0.24, 0.41]) place(out, at, clack(), SR);
    return out;
  },

  // soft bubble pop: a falling-then-settling sine sweep
  pop() {
    return generate(0.22, SR, (t) => Math.sin(2 * Math.PI * (500 + 400 * (1 - Math.exp(-t * 60))) * t) * Math.exp(-t * 20));
  },

  // switch toggle: two tones, the second higher
  toggle() {
    const out = new Float64Array(Math.round(0.25 * SR));
    place(out, 0, generate(0.07, SR, (t) => tone(880, t, 60)), SR);
    place(out, 0.09, generate(0.16, SR, (t) => tone(1320, t, 28)), SR);
    return out;
  },

  // success chime: rising C-E-G arpeggio that rings into a high C
  success() {
    const out = new Float64Array(Math.round(0.85 * SR));
    const notes = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36]];
    for (const [f, at] of notes) place(out, at, generate(0.5, SR, (t) => bell(f, t, 7)), SR);
    return out;
  },

  // two-note door chime: E5 then C5
  'ding-dong'() {
    const out = new Float64Array(Math.round(1.15 * SR));
    place(out, 0, generate(0.9, SR, (t) => bell(659.25, t, 3.2)), SR);
    place(out, 0.45, generate(0.7, SR, (t) => bell(523.25, t, 3.6)), SR);
    return out;
  },

  // closing pad: C major chord swelling in and settling
  resolve() {
    return generate(1.55, SR, (t) => {
      const swell = Math.min(1, t / 0.35) * Math.exp(-t * 1.6);
      return swell * (tone(130.81, t, 0) + tone(261.63, t, 0) * 0.7 + tone(329.63, t, 0) * 0.5 + tone(392, t, 0) * 0.35) * 0.45;
    });
  },

  // air whoosh: noise through a one-pole low-pass whose cutoff rises through the sound, under a hump envelope
  whoosh(noise) {
    const length = 0.38;
    const out = new Float64Array(Math.round(length * SR));
    let state = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const cutoff = 300 + 2700 * (t / length) ** 2;
      state += (1 - Math.exp((-2 * Math.PI * cutoff) / SR)) * (noise() - state);
      out[i] = state * Math.sin((Math.PI * t) / length);
    }
    return out;
  },
};

function main(outDir) {
  mkdirSync(outDir, {recursive: true});
  for (const [name, make] of Object.entries(SOUNDS)) {
    const noise = seeded(name.length * 9973 + 17);
    const signal = fade(normalize(make(noise), PEAK), SR, 0.002, 0.01);
    writeFileSync(path.join(outDir, `${name}.wav`), encodeWav([signal], SR));
    console.log(`${name}.wav  ${(signal.length / SR).toFixed(2)} s`);
  }
}

main(process.argv[2] ?? path.join(HERE, '..', 'engine', 'assets', 'sfx'));

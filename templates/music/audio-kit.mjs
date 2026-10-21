// Shared synthesis helpers for the music templates and the sound-effect generator. No dependencies.
// Signals are Float64Array mono buffers; stereo is an array of two buffers.

/** Seeded PRNG (mulberry32): the same seed gives the same noise, so renders are repeatable. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample from a uniform source (Box-Muller). */
export function gaussian(uniform) {
  const u = 1 - uniform();
  const v = uniform();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** MIDI note number to frequency in Hz (A4 = 69 = 440 Hz). */
export const hz = midi => 440 * 2 ** ((midi - 69) / 12);

/** A buffer of `seconds` length filled by fn(t, index), t in seconds. */
export function generate(seconds, sampleRate, fn) {
  const out = new Float64Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / sampleRate, i);
  return out;
}

/** Adds `signal` into `buffer` starting at `at` seconds (clipped at the buffer end). */
export function place(buffer, at, signal, sampleRate) {
  const start = Math.round(at * sampleRate);
  if (start < 0 || start >= buffer.length) return;
  const end = Math.min(buffer.length, start + signal.length);
  for (let i = start; i < end; i++) buffer[i] += signal[i - start];
}

/** Second-order (RBJ cookbook) low-pass filter, Q = 0.7071 unless given. */
export function lowpass(signal, cutoff, sampleRate, q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0;
  const b1 = (1 - cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float64Array(signal.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x = signal[i];
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** High-pass as signal minus its low-passed copy (first order, good enough for clicks and hats). */
export function highpass(signal, cutoff, sampleRate) {
  const low = lowpass(signal, cutoff, sampleRate, 0.5);
  return signal.map((x, i) => x - low[i]);
}

/** Scales a buffer so its absolute peak equals `peak`. Silent buffers are returned unchanged. */
export function normalize(signal, peak) {
  let max = 0;
  for (const x of signal) max = Math.max(max, Math.abs(x));
  if (max === 0) return signal;
  const gain = peak / max;
  return signal.map(x => x * gain);
}

/** Linear fade-in and fade-out, in seconds, applied in place. */
export function fade(signal, sampleRate, fadeIn, fadeOut) {
  const nIn = Math.min(signal.length, Math.round(fadeIn * sampleRate));
  const nOut = Math.min(signal.length, Math.round(fadeOut * sampleRate));
  for (let i = 0; i < nIn; i++) signal[i] *= i / nIn;
  for (let i = 0; i < nOut; i++) signal[signal.length - 1 - i] *= i / nOut;
  return signal;
}

/** 16-bit PCM WAV for one or more channels of Float64Array samples in [-1, 1]. */
export function encodeWav(channels, sampleRate) {
  const count = channels[0].length;
  const numChannels = channels.length;
  const dataBytes = count * numChannels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * 2, 28);
  buf.writeUInt16LE(numChannels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let i = 0; i < count; i++) {
    for (const channel of channels) {
      const x = Math.max(-1, Math.min(1, channel[i]));
      buf.writeInt16LE(Math.round(x * 32767), offset);
      offset += 2;
    }
  }
  return buf;
}

#!/usr/bin/env node
// Basic delivery check: the video has audio, its duration and size match plan.json, shots sit on 2 s bar lines,
// and cues fall inside the film on the 0.5 s beat grid. Prints JSON; exits 1 when there are errors.
//   node scripts/check-delivery.mjs <video-dir> <video.mp4>
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {capture} from './lib/run.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const video = process.argv[3];
const plan = JSON.parse(readFileSync(path.join(root, 'plan.json'), 'utf8'));
const errors = [];
const warnings = [];

const probe = JSON.parse(capture('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
  '-of', 'json', video]).toString('utf8'));
const kinds = probe.streams.map(s => s.codec_type);
if (!kinds.includes('audio')) errors.push('no audio stream');
const dur = Number(probe.format.duration);
if (Math.abs(dur - plan.duration) > 0.3) errors.push(`duration ${dur.toFixed(2)}s != plan ${plan.duration}s`);
const videoStream = probe.streams.find(s => s.codec_type === 'video');
if (videoStream.width !== plan.width || videoStream.height !== plan.height) {
  errors.push(`size ${videoStream.width}x${videoStream.height} != plan`);
}
for (const s of plan.shots) {
  if (s.start % 2 || s.end % 2) warnings.push(`shot ${s.id} not on a 2 s bar line`);
}
for (const cue of plan.audio.cues) {
  if (!(cue.at >= 0 && cue.at < plan.duration)) errors.push(`cue ${cue.actionId} outside the film`);
  if ((cue.at * 2) % 1) warnings.push(`cue ${cue.actionId} not on a 0.5 s beat`);
}
console.log(JSON.stringify({ok: errors.length === 0, errors, warnings}));
process.exit(errors.length ? 1 : 0);

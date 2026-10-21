#!/usr/bin/env node
// Mixes music and SFX cues from plan.json with ffmpeg (loudnorm to -16 LUFS) into assets/master.wav, and writes
// evidence/audio-mix.json, which render-film.mjs checks before it renders the delivered film.
//   node scripts/mix-audio.mjs <video-dir>
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {run} from './lib/run.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const plan = JSON.parse(readFileSync(path.join(root, 'plan.json'), 'utf8'));
const dur = plan.duration;
const music = plan.audio.music;
const cues = plan.audio.cues;

const args = ['-y', '-v', 'error', '-i', path.join(root, music.file)];
const parts = [`[0:a]volume=${music.gain},atrim=0:${dur},apad=whole_dur=${dur}[m]`];
const labels = ['[m]'];
cues.forEach((cue, index) => {
  const i = index + 1;
  args.push('-i', path.join(root, cue.file));
  const ms = Math.round(cue.at * 1000);
  parts.push(`[${i}:a]volume=${cue.gain},adelay=${ms}|${ms}[s${i}]`);
  labels.push(`[s${i}]`);
});
parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,` +
  `loudnorm=I=-16:TP=-1.5:LRA=11,atrim=0:${dur}[out]`);
const out = path.join(root, 'assets', 'master.wav');
args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', out);
run('ffmpeg', args);
console.log('mixed', out);

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const report = {
  planSha256: sha(path.join(root, 'plan.json')),
  mixer: 'ffmpeg (music + sfx, loudnorm -16 LUFS, no ducking)',
  music: {...music, sha256: sha(path.join(root, music.file))},
  cues: cues.map(cue => ({...cue, sha256: sha(path.join(root, cue.file))})),
  master: {file: 'assets/master.wav', sha256: sha(out)},
};
writeFileSync(path.join(root, 'evidence', 'audio-mix.json'), JSON.stringify(report, null, 1));

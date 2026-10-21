#!/usr/bin/env node
// Gives a video an opening that says what it is and what problem it solves.
//   node scripts/set-intro.mjs <video-dir> [--seconds 8]
// Reads  : <video-dir>/intro.json = {headlineEn, headline, description, notice: {title, tag, body}, narration}
// Changes: plan.json intro text and length; every later shot and sound cue shifts by the length change and the
//          plan duration is recomputed; narration.json "intro" line is replaced; assets/music.wav is regenerated
//          when the project has assets/music/make-music.mjs.
// Then run pipeline.sh again: the opening poster (public/poster.png) must be regenerated as well.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {run} from './lib/run.mjs';

const args = process.argv.slice(2);
const root = path.resolve(args.find(arg => !arg.startsWith('--')) ?? '.');
const secondsAt = args.indexOf('--seconds');
const seconds = secondsAt >= 0 ? Number(args[secondsAt + 1]) : 8;

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const round3 = value => Math.round(value * 1000) / 1000;

const intro = readJson(path.join(root, 'intro.json'));
const planPath = path.join(root, 'plan.json');
const plan = readJson(planPath);
const shots = plan.shots;
const opening = shots[0];
if (opening.id !== 'intro') throw new Error('the first shot must be the intro');

const oldLength = opening.end - opening.start;
const delta = seconds - oldLength;
for (const s of shots.slice(1)) {
  s.start = round3(s.start + delta);
  s.end = round3(s.end + delta);
}
opening.end = round3(opening.start + seconds);
for (const key of ['headlineEn', 'headline', 'description']) opening[key] = intro[key];
opening.notice = intro.notice;

// each sound cue moves with the action it belongs to
const actionById = new Map();
for (const s of shots) for (const action of s.actions) actionById.set(action.id, {shot: s, action});
for (const cue of plan.audio.cues) {
  const {shot, action} = actionById.get(cue.actionId);
  cue.at = round3(shot.start + action.at - (cue.syncOffset ?? 0));
}
plan.duration = shots[shots.length - 1].end;
writeJson(planPath, plan);

const narrationPath = path.join(root, 'narration.json');
if (existsSync(narrationPath)) {
  const narration = readJson(narrationPath);
  narration.lines.intro = intro.narration;
  writeJson(narrationPath, narration);
}

const termsPath = path.join(root, '.privacy-terms');
if (existsSync(termsPath)) {
  const terms = readFileSync(termsPath, 'utf8').split(/\r?\n/).map(t => t.trim()).filter(Boolean);
  const blob = JSON.stringify(intro).toLowerCase();
  for (const term of terms) {
    if (blob.includes(term.toLowerCase())) throw new Error(`privacy: intro.json contains "${term}"`);
  }
}

const makeMusic = path.join(root, 'assets', 'music', 'make-music.mjs');
if (existsSync(makeMusic)) {
  run(process.execPath, ['assets/music/make-music.mjs', 'assets/music.wav', 'plan.json'], {cwd: root});
}

console.log(`intro ${oldLength.toFixed(0)}s -> ${seconds.toFixed(0)}s, later shots +${delta.toFixed(0)}s, duration ${plan.duration}s`);
for (const s of shots) {
  console.log(`  ${s.id.padEnd(9)} ${s.start.toFixed(1).padStart(6)} - ${s.end.toFixed(1).padStart(6)}`);
}

#!/usr/bin/env node
// Tiles stills (or frames pulled from an MP4) into one review image.
//   node scripts/contact-sheet.mjs <stills-dir> <out.png> [cols]
//   node scripts/contact-sheet.mjs --video <final.mp4> <out.png> <t1> <t2> ...
import {mkdtempSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {run} from './lib/run.mjs';

const GAP = 6;
const GREY = 'gray';

// Scales every input to w x h, pads it with a grey gap on the right and bottom, and places the cells on a grid.
function tile(files, out, cols, w = 480, h = 270) {
  const rows = Math.ceil(files.length / cols);
  const cell = {w: w + GAP, h: h + GAP};
  const args = [];
  files.forEach(file => args.push('-i', file));
  const chains = files.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=disable,` +
    `pad=${cell.w}:${cell.h}:0:0:color=${GREY}[c${i}]`);
  const layout = files.map((_, i) => `${(i % cols) * cell.w}_${Math.floor(i / cols) * cell.h}`);
  const labels = files.map((_, i) => `[c${i}]`).join('');
  const filter = `${chains.join(';')};${labels}xstack=inputs=${files.length}:layout=${layout.join('|')}:fill=${GREY}[out]`;
  run('ffmpeg', ['-y', '-v', 'error', ...args, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1',
    path.resolve(out)]);
  console.log(`${out}: ${files.length} frames, ${cols * cell.w}x${rows * cell.h} grid`);
}

function main(argv) {
  if (argv[0] === '--video') {
    const [, video, out, ...times] = argv;
    const dir = mkdtempSync(path.join(tmpdir(), 'contact-'));
    const files = times.map(t => {
      const file = path.join(dir, `${Number(t).toFixed(2).padStart(7, '0')}.png`);
      run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t, '-i', video, '-frames:v', '1', file]);
      return file;
    });
    tile(files, out, Math.min(3, files.length), 960, 540);
    return;
  }
  const [dir, out, colsArg] = argv;
  const files = readdirSync(dir).filter(name => name.endsWith('.png')).sort().map(name => path.join(dir, name));
  tile(files, out, colsArg ? Number(colsArg) : 4);
}

main(process.argv.slice(2));

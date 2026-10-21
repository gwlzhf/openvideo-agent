// Exports the cover images from cover/cover.html. Every element marked data-cover="3x4" | "4x3" | "16x9" is saved
// at its CSS size times --scale (default 2). Usage: node render-covers.mjs [--scale 2] [--out covers]
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {browserArgs} from './pick-hardware.mjs';

const CANVAS = new Map([
  ['3x4', {width: 1080, height: 1440}],
  ['4x3', {width: 1440, height: 1080}],
  ['16x9', {width: 1920, height: 1080}],
]);

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
};
const scale = Number(option('--scale', 2));
const outDir = option('--out', 'covers');

await mkdir(outDir, {recursive: true});
const browser = await chromium.launch({headless: true, args: browserArgs});
try {
  const page = await browser.newPage({viewport: {width: 2000, height: 1600}, deviceScaleFactor: scale});
  const problems = [];
  page.on('pageerror', err => problems.push(err.message));
  page.on('requestfailed', req => problems.push(`request failed: ${req.url()}`));
  await page.goto(pathToFileURL(path.resolve('cover/cover.html')).href, {waitUntil: 'load'});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.allSettled([...document.images].map(img => img.decode())));

  const boxes = await page.$$eval('[data-cover]', els => els.map(el => {
    const rect = el.getBoundingClientRect();
    return {ratio: el.dataset.cover, x: rect.x, y: rect.y, width: el.offsetWidth, height: el.offsetHeight};
  }));
  if (boxes.length === 0) throw new Error('cover/cover.html has no element with data-cover');

  for (const box of boxes) {
    const canvas = CANVAS.get(box.ratio);
    if (!canvas) throw new Error(`unknown ratio "${box.ratio}"; expected ${[...CANVAS.keys()].join(', ')}`);
    if (box.width !== canvas.width || box.height !== canvas.height) {
      throw new Error(`${box.ratio} element measures ${box.width}x${box.height}px, needs ${canvas.width}x${canvas.height}`);
    }
    const file = path.join(outDir, `cover-${box.ratio}.png`);
    await page.screenshot({path: file, clip: {x: box.x, y: box.y, width: box.width, height: box.height}});
    console.log(file, `${canvas.width * scale}x${canvas.height * scale}`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
} finally {
  await browser.close();
}

// Stills at the given film times, taken in one browser session.
//   node capture-stills.mjs <dir> <seconds> [seconds ...]
// Prints the page errors and the API paths the film requested, so a missing fixture is easy to spot.
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {browserArgs} from './pick-hardware.mjs';
import {serve} from './static-server.mjs';

const cliArgs = process.argv.slice(2);
const dir = cliArgs.length ? cliArgs[0] : 'evidence/stills';
const times = cliArgs.slice(1);
const plan = JSON.parse(await readFile('plan.json', 'utf8'));
const fileFor = seconds => `t${Number(seconds).toFixed(2).padStart(6, '0')}.png`;

await mkdir(dir, {recursive: true});
const site = await serve();
const browser = await chromium.launch({headless: true, args: browserArgs});
try {
  const page = await browser.newPage({viewport: {width: plan.width, height: plan.height}});
  const problems = [];
  page.on('pageerror', err => problems.push(`pageerror ${err.message}`));
  page.on('response', res => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
  });
  await page.goto(site.url, {waitUntil: 'networkidle'});
  await page.evaluate(() => window.__filmReady);
  for (const seconds of times) {
    await page.evaluate(sec => window.seek(sec), Number(seconds));
    await page.screenshot({path: path.join(dir, fileFor(seconds))});
  }
  const requested = await page.evaluate(() => [...new Set(window.__filmApiLog ?? [])]);
  console.log(`${times.length} still(s) written to ${dir}`);
  console.log(`page problems: ${problems.length ? problems.join(' | ') : 'none'}`);
  console.log(`api requests: ${requested.length ? requested.join(', ') : 'none'}`);
} finally {
  await browser.close();
  site.server.close();
}

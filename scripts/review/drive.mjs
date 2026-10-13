// Full throttle on one track until sim time reaches each checkpoint; one screenshot per checkpoint.
// usage: node scripts/review/drive.mjs <baseUrl> <outDir> <track> <simSec,simSec,...>
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { ARGS, openGame, setup, snapshot } from './lib.mjs';

const { baseUrl, outDir } = setup(process.argv);
const track = process.argv[4] ?? 'monza';
const marks = (process.argv[5] ?? '8,12').split(',').map(Number);

const browser = await chromium.launch({ args: ARGS });
const { page, ready } = await openGame(browser, `${baseUrl}/?track=${track}`);
if (!ready) throw new Error('game not ready');
const t0 = await page.evaluate(() => window.__SIMGAME__.getSimTime());
await page.keyboard.down('ArrowUp');
const out = [];
for (const s of marks) {
  await page.waitForFunction((t) => window.__SIMGAME__.getSimTime() >= t, t0 + s, { timeout: 600000, polling: 200 });
  const file = `${outDir}/${track}-drive${s}s.png`;
  await page.screenshot({ path: file });
  out.push({ file, ...(await snapshot(page)) });
}
await page.keyboard.up('ArrowUp');
writeFileSync(`${outDir}/drive-${track}.json`, JSON.stringify(out, null, 2));
await browser.close();

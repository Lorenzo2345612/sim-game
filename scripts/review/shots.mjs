#!/usr/bin/env node
// usage: node scripts/review/shots.mjs <baseUrl> <outDir>
import { ARGS, chromium, openGame, save, setup, snapshot } from './lib.mjs';

const TRACKS = ['monza', 'spa', 'silverstone'];
const { baseUrl, outDir } = setup(process.argv);
const browser = await chromium.launch({ args: ARGS });
const report = { baseUrl, tracks: [] };
const seen = new Set();

for (const track of TRACKS) {
  const errors = [];
  const entry = { track, shots: [], errors };
  let { page, ready } = await openGame(browser, `${baseUrl}/?track=${track}`, errors);
  let id = ready ? await snapshot(page) : {};
  entry.trackParamSupported = id.trackId === track;
  if (ready && id.trackId !== undefined && id.trackId !== track) {
    await page.close();
    ({ page, ready } = await openGame(browser, `${baseUrl}/`, errors));
    id = ready ? await snapshot(page) : {};
  }
  const name = id.trackId ?? 'default';
  if (ready && seen.has(name)) {
    entry.skipped = `build serves ${name} only (no track param)`;
    await page.close();
    report.tracks.push(entry);
    continue;
  }
  seen.add(name);
  entry.ready = ready;
  entry.servedTrack = name;
  const shot = async (label) => {
    const file = `${name}-${label}.png`;
    await page.screenshot({ path: `${outDir}/${file}` });
    entry.shots.push({ label, file, state: ready ? await snapshot(page) : null });
  };
  await shot('start');
  if (ready) {
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(4000);
    await shot('throttle4s');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2000);
    await shot('throttle-steer2s');
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');
    const hook = await page.evaluate(() => {
      const g = window.__SIMGAME__ ?? {};
      for (const k of ['showMinimap', 'setTopDown', 'topDownView', 'toggleMinimap']) {
        if (typeof g[k] === 'function') { g[k](); return k; }
      }
      return null;
    });
    if (hook) {
      await page.waitForTimeout(500);
      await shot('topdown');
    } else {
      const mini = await page.$('#minimap, canvas.minimap, .minimap');
      if (mini) {
        await mini.screenshot({ path: `${outDir}/${name}-minimap.png` });
        entry.shots.push({ label: 'minimap', file: `${name}-minimap.png` });
      }
    }
    entry.hud = await page.evaluate(() => {
      const el = document.getElementById('hud');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        text: el.innerText.slice(0, 200),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        inViewport: r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
      };
    });
    entry.fps = await page.evaluate(
      () => new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = (t) => (t - t0 < 3000 ? (n++, requestAnimationFrame(f)) : res(+(n / ((t - t0) / 1000)).toFixed(1)));
        requestAnimationFrame(f);
      }),
    );
    entry.fpsNote = 'software GL (swiftshader): far below a real GPU';
  }
  await page.close();
  report.tracks.push(entry);
}
await browser.close();
save(outDir, 'report.json', report);
console.log(`wrote ${outDir}/report.json (${report.tracks.length} tracks, errors: ${report.tracks.reduce((a, t) => a + t.errors.length, 0)})`);

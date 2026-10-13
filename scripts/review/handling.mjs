#!/usr/bin/env node
// usage: node scripts/review/handling.mjs <baseUrl> <outDir>
import { ARGS, chromium, openGame, save, setup } from './lib.mjs';

const TARGETS = {
  zeroTo100Sec: [3, 4.5],
  topSpeedKmh: [200, 240],
  brake150To0MaxM: 80,
  spinAngleDeg: 60,
  topSpeedRunSec: 15,
  minSpeedForSpinCheckKmh: 20,
};
const { baseUrl, outDir } = setup(process.argv);
const browser = await chromium.launch({ args: ARGS });

// In-page recorder: samples every 10 ms into window.__rec (sim time, km/h, position, heading when exposed).
const startRec = (page) =>
  page.evaluate(() => {
    const g = window.__SIMGAME__;
    const pos = () => {
      for (const k of ['getCarPosition', 'getPosition', 'carPosition']) {
        const f = g[k];
        if (!f) continue;
        const p = typeof f === 'function' ? f() : f;
        return Array.isArray(p) ? { x: p[0], z: p[2] ?? p[1] } : { x: p.x, z: p.z };
      }
      return null;
    };
    const hd = () => {
      for (const k of ['getHeading', 'getYaw', 'getCarYaw', 'getCarHeading']) {
        if (!g[k]) continue;
        const h = g[k]();
        return typeof h === 'number' ? { x: -Math.sin(h), z: -Math.cos(h) } : h;
      }
      return null;
    };
    window.__rec = [];
    window.__recT = setInterval(() => {
      window.__rec.push({ t: g.getSimTime ? g.getSimTime() : performance.now() / 1000, v: g.getSpeedKmh(), p: pos(), h: hd() });
    }, 10);
  });
const stopRec = (page) => page.evaluate(() => { clearInterval(window.__recT); return window.__rec; });
const recLen = (page) => page.evaluate(() => window.__rec.length);
const lastT = (page) => page.evaluate(() => window.__rec[window.__rec.length - 1].t);
const untilSpeed = (page, kmh, ms) =>
  page.waitForFunction((k) => window.__SIMGAME__.getSpeedKmh() >= k, kmh, { timeout: ms, polling: 10 }).then(() => true, () => false);
const untilSimTime = (page, t, ms) =>
  page.waitForFunction((t0) => window.__rec[window.__rec.length - 1].t >= t0, t, { timeout: ms, polling: 20 }).catch(() => {});

async function fresh() {
  const r = await openGame(browser, `${baseUrl}/?track=monza`); // / shows the track menu since M1.2
  if (!r.ready) throw new Error('game not ready');
  await startRec(r.page);
  return r.page;
}
const inRange = (v, [lo, hi]) => (v == null ? null : v >= lo && v <= hi);
const angle = (a, b) => {
  const c = (a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const result = { targets: TARGETS };

try {
  // 0-100 and top speed
  let page = await fresh();
  await page.keyboard.down('ArrowUp');
  await untilSimTime(page, (await lastT(page)) + TARGETS.topSpeedRunSec, 120000);
  await page.keyboard.up('ArrowUp');
  let rec = await stopRec(page);
  const tStart = (rec.find((s) => s.v > 0.5) ?? rec[0]).t;
  const s100 = rec.find((s) => s.v >= 100);
  result.zeroTo100Sec = s100 ? +(s100.t - tStart).toFixed(2) : null;
  result.topSpeedKmh = +Math.max(...rec.map((s) => s.v)).toFixed(1);
  result.topSpeedRunSimSec = +(rec[rec.length - 1].t - tStart).toFixed(1);
  await page.close();

  // braking 150 -> 0
  page = await fresh();
  await page.keyboard.down('ArrowUp');
  const got = await untilSpeed(page, 150, 90000);
  await page.keyboard.up('ArrowUp');
  const bi = await recLen(page);
  if (got) {
    await page.keyboard.down('ArrowDown');
    await page.waitForFunction(() => window.__SIMGAME__.getSpeedKmh() < 2, undefined, { timeout: 30000, polling: 20 }).catch(() => {});
    await page.keyboard.up('ArrowDown');
  }
  const seg = (await stopRec(page)).slice(bi);
  let dist = 0;
  for (let i = 1; i < seg.length; i++) dist += ((seg[i].v + seg[i - 1].v) / 2 / 3.6) * (seg[i].t - seg[i - 1].t);
  result.brake150To0M = got && seg.length && seg[seg.length - 1].v < 2 ? +dist.toFixed(1) : null;
  await page.close();

  // brake + full steer at ~150 km/h for 2 s
  page = await fresh();
  await page.keyboard.down('ArrowUp');
  const ok = await untilSpeed(page, 150, 90000);
  await page.keyboard.up('ArrowUp');
  const si = await recLen(page);
  if (ok) {
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowLeft');
    await untilSimTime(page, (await lastT(page)) + 2, 30000);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowLeft');
  }
  const r3 = (await stopRec(page)).slice(si);
  const hasHeading = r3.some((s) => s.h);
  const hasPos = r3.some((s) => s.p);
  const dirs = [];
  for (let i = 5; i < r3.length; i++) {
    const a = r3[i - 5].p, b = r3[i].p;
    dirs.push(a && b && Math.hypot(b.x - a.x, b.z - a.z) > 0.05 ? { x: b.x - a.x, z: b.z - a.z } : null);
  }
  let method = 'none', headingChange = null, maxSlip = null, spun = null;
  if (hasHeading && hasPos) {
    method = 'heading-vs-velocity';
    maxSlip = 0;
    for (let i = 5; i < r3.length; i++) {
      const d = dirs[i - 5];
      if (d && r3[i].h && r3[i].v > TARGETS.minSpeedForSpinCheckKmh) maxSlip = Math.max(maxSlip, angle(r3[i].h, d));
    }
    const h0 = r3.find((s) => s.h)?.h, h1 = [...r3].reverse().find((s) => s.h)?.h;
    headingChange = h0 && h1 ? +angle(h0, h1).toFixed(1) : null;
    maxSlip = +maxSlip.toFixed(1);
    spun = maxSlip > TARGETS.spinAngleDeg;
  } else if (hasPos) {
    method = 'velocity-direction-only';
    const ds = dirs.filter(Boolean);
    headingChange = ds.length > 1 ? +angle(ds[0], ds[ds.length - 1]).toFixed(1) : null;
  }
  result.brakeSteer = {
    reached150: ok, method, headingChangeDeg: headingChange, maxSlipDeg: maxSlip, spun,
    endSpeedKmh: r3.length ? +r3[r3.length - 1].v.toFixed(1) : null,
    note: spun == null ? 'build exposes no heading+position; spin not measurable' : undefined,
  };
  await page.close();

  result.pass = {
    zeroTo100: inRange(result.zeroTo100Sec, TARGETS.zeroTo100Sec),
    topSpeed: inRange(result.topSpeedKmh, TARGETS.topSpeedKmh),
    braking: result.brake150To0M == null ? null : result.brake150To0M < TARGETS.brake150To0MaxM,
    noSpin: spun == null ? null : !spun,
  };
} catch (e) {
  result.error = String(e);
}
await browser.close();
save(outDir, 'handling.json', result);
console.log(JSON.stringify(result, null, 1));

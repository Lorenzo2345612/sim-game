import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 070 extends window.__SIMGAME__ with telemetry(); the global declaration in
// src/main.ts only gains it when the task is implemented.
type WheelTel070 = { fz: number; kappa: number; alpha: number; tempC: number; wear: number };
type Tel070 = { wheels: WheelTel070[]; fuelKg: number; rpm: number; gear: number };
type Debug070 = { telemetry(): Tel070 };
type Sample070 = { h: number; x: number; z: number; v: number };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function simTime(page: Page): Promise<number> {
  return page.evaluate(() => window.__SIMGAME__!.getSimTime());
}

async function waitSim(page: Page, seconds: number, timeout = 180000): Promise<void> {
  const t0 = await simTime(page);
  await page.waitForFunction(
    (target) => {
      const g = window.__SIMGAME__;
      return !!g && g.getSimTime() >= target;
    },
    t0 + seconds,
    { timeout },
  );
}

function telemetry(page: Page): Promise<Tel070> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug070).telemetry());
}

async function startSpeedMax(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __max070?: number; __maxIv070?: number };
    w.__max070 = 0;
    w.__maxIv070 = window.setInterval(() => {
      const v = window.__SIMGAME__?.getSpeedKmh() ?? 0;
      if (v > (w.__max070 ?? 0)) w.__max070 = v;
    }, 20);
  });
}

async function stopSpeedMax(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __max070?: number; __maxIv070?: number };
    if (w.__maxIv070 !== undefined) window.clearInterval(w.__maxIv070);
    return w.__max070 ?? 0;
  });
}

async function startRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __rec070?: Sample070[]; __recIv070?: number };
    w.__rec070 = [];
    w.__recIv070 = window.setInterval(() => {
      const g = window.__SIMGAME__;
      if (!g) return;
      const p = g.carPosition();
      w.__rec070?.push({ h: g.getHeading(), x: p.x, z: p.z, v: g.getSpeedKmh() });
    }, 20);
  });
}

async function stopRecorder(page: Page): Promise<Sample070[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __rec070?: Sample070[]; __recIv070?: number };
    if (w.__recIv070 !== undefined) window.clearInterval(w.__recIv070);
    return w.__rec070 ?? [];
  });
}

async function primeRearWing(page: Page, rearWing: number): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (v) => {
    const res = await fetch('/cars/f4.json');
    const spec = (await res.json()) as { setup: Record<string, { default: number }> };
    const setup: Record<string, number> = {};
    for (const k of Object.keys(spec.setup)) setup[k] = spec.setup[k].default;
    setup.rearWing = v;
    localStorage.setItem('setup:f4:monza', JSON.stringify(setup));
  }, rearWing);
}

async function topSpeedOverRun(page: Page, seconds: number): Promise<number> {
  await loadGame(page, '/?track=monza');
  await startSpeedMax(page);
  await page.keyboard.down('ArrowUp');
  await waitSim(page, seconds, 300000);
  await page.keyboard.up('ArrowUp');
  return stopSpeedMax(page);
}

async function meanWear(page: Page, wearQuery: string): Promise<number> {
  await loadGame(page, `/?track=monza&wear=${wearQuery}`);
  await page.keyboard.down('ArrowUp');
  await waitSim(page, 30, 360000);
  await page.keyboard.up('ArrowUp');
  const t = await telemetry(page);
  return t.wheels.reduce((s, w) => s + w.wear, 0) / t.wheels.length;
}

test.describe('070 dynamics integration', () => {
  test('AT1: 5 s of throttle on monza exceeds 100 km/h with 4 finite telemetry wheels and decreasing fuel', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?track=monza');
    const before = await telemetry(page);
    await page.keyboard.down('ArrowUp');
    await waitSim(page, 5);
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    await page.keyboard.up('ArrowUp');
    const after = await telemetry(page);
    expect(speed).toBeGreaterThan(100);
    expect(after.wheels).toHaveLength(4);
    for (const w of after.wheels) {
      for (const v of [w.fz, w.kappa, w.alpha, w.tempC, w.wear]) expect(Number.isFinite(v)).toBe(true);
    }
    expect(after.fuelKg).toBeLessThan(before.fuelKg);
  });

  test('AT2: rear wing at max is more than 3 km/h slower than at min after 20 s of throttle', async ({ page }) => {
    test.setTimeout(600000);
    await primeRearWing(page, 10);
    const topMaxWing = await topSpeedOverRun(page, 20);
    await primeRearWing(page, 0);
    const topMinWing = await topSpeedOverRun(page, 20);
    expect(topMinWing - topMaxWing).toBeGreaterThan(3);
  });

  test('AT3: ?wear=5 gives 4 to 6 times the wear of ?wear=1 over the same 30 s script', async ({ page }) => {
    test.setTimeout(600000);
    const wear1 = await meanWear(page, '1');
    const wear5 = await meanWear(page, '5');
    const ratio = wear5 / wear1;
    expect(ratio).toBeGreaterThanOrEqual(4);
    expect(ratio).toBeLessThanOrEqual(6);
  });

  test('AT4: brake plus full left steer at 150 km/h keeps heading within 30 deg of velocity', async ({ page }) => {
    test.setTimeout(300000);
    await loadGame(page, '/?track=monza');
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction(() => (window.__SIMGAME__?.getSpeedKmh() ?? 0) >= 150, undefined, {
      timeout: 180000,
      polling: 50,
    });
    await page.keyboard.up('ArrowUp');
    await startRecorder(page);
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowLeft');
    await waitSim(page, 2);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowLeft');
    const rec = await stopRecorder(page);
    // Slip = angle between heading and displacement; below 3 m/s the direction is noise (066 AT5).
    let checked = 0;
    let maxSlip = 0;
    for (let i = 1; i < rec.length; i++) {
      const dx = rec[i].x - rec[i - 1].x;
      const dz = rec[i].z - rec[i - 1].z;
      const disp = Math.hypot(dx, dz);
      if (rec[i].v < 3 * 3.6 || disp < 0.05) continue;
      checked++;
      const cos = (-Math.sin(rec[i].h) * dx - Math.cos(rec[i].h) * dz) / disp;
      const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
      if (angle > maxSlip) maxSlip = angle;
    }
    expect(checked).toBeGreaterThan(0);
    expect(maxSlip).toBeLessThan(30);
  });

  test('AT6: the running game shows 4 tyre boxes in .tyres and a .fuel visible in the viewport', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const tyres = page.locator('.tyres');
    await expect(tyres).toBeVisible();
    expect(await tyres.locator('.tyre').count()).toBe(4);
    const fuel = page.locator('.tyres .fuel');
    await expect(fuel).toBeVisible();
    const box = await fuel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  });
});

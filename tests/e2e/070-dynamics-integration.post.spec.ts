import { expect, test } from '@playwright/test';

test.describe('070 dynamics integration gaps', () => {
  test('POST1: 10 s of driving logs no console errors and keeps telemetry finite', async ({ page }) => {
    test.setTimeout(360000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?track=monza');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction((target) => (window.__SIMGAME__?.getSimTime() ?? 0) >= target, t0 + 10, {
      timeout: 300000,
      polling: 50,
    });
    await page.keyboard.up('ArrowUp');

    const t = await page.evaluate(() => window.__SIMGAME__!.telemetry());
    expect(t.wheels).toHaveLength(4);
    for (const w of t.wheels) {
      expect(Number.isFinite(w.fz)).toBe(true);
      expect(Number.isFinite(w.kappa)).toBe(true);
      expect(Number.isFinite(w.alpha)).toBe(true);
      expect(Number.isFinite(w.tempC)).toBe(true);
      expect(Number.isFinite(w.wear)).toBe(true);
    }
    expect(Number.isFinite(t.fuelKg)).toBe(true);
    expect(t.fuelKg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(t.rpm)).toBe(true);
    expect(Number.isFinite(t.gear)).toBe(true);
    expect(Number.isFinite(await page.evaluate(() => window.__SIMGAME__!.getHeading()))).toBe(true);
    expect(errors).toEqual([]);
  });
});

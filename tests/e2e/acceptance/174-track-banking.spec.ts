import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

/** Centerline index nearest 4620 m along daytona.json. */
function nearestIndexTo4620(): number {
  const json = JSON.parse(
    readFileSync(join(process.cwd(), 'public/tracks/daytona.json'), 'utf8'),
  ) as { centerline: [number, number][] };
  const cx = json.centerline;
  let cum = 0;
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < cx.length; i++) {
    if (i > 0) cum += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const d = Math.abs(cum - 4620);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI;
}

test.describe('174 track banking', () => {
  test('AT7: car stays on the banked daytona turns 3-4 for 3 s of throttle', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?track=daytona');
    await page.evaluate((i) => window.__SIMGAME__!.teleportToIndex(i), nearestIndexTo4620());
    await page.keyboard.down('ArrowUp');
    const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    let counted = 0;
    // Poll in real time: under load the browser can step several sim seconds per frame.
    for (;;) {
      await page.waitForTimeout(50);
      const simTime = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
      if (simTime > t0 + 3.5) break;
      counted++;
      const label = `sample ${counted} at t+${(simTime - t0).toFixed(2)}s`;
      const surface = await page.evaluate(() => window.__SIMGAME__!.surfaceUnderCar());
      expect(surface, label).toBe('asphalt');
      const dy = await page.evaluate(
        () => window.__SIMGAME__!.carPosition().y - window.__SIMGAME__!.trackHeightUnderCar(),
      );
      expect(dy, label).toBeGreaterThanOrEqual(0);
      expect(dy, label).toBeLessThanOrEqual(1);
    }
    expect(counted).toBeGreaterThanOrEqual(3);
    await page.keyboard.up('ArrowUp');
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(30);
  });
});

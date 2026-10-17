import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

/** Centerline index nearest 2020 m along fontana.json. */
function nearestIndexTo2020(): number {
  const json = JSON.parse(
    readFileSync(join(process.cwd(), 'public/tracks/fontana.json'), 'utf8'),
  ) as { centerline: [number, number][] };
  const cx = json.centerline;
  let cum = 0;
  let best = Infinity;
  let bestI = 0;
  for (let i = 0; i < cx.length; i++) {
    if (i > 0) cum += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const d = Math.abs(cum - 2020);
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  return bestI;
}

test.describe('175 fontana banking', () => {
  test('AT3: car stays on the banked fontana front stretch for 5 s of throttle', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?track=fontana');
    await page.evaluate((i) => window.__SIMGAME__!.teleportToIndex(i), nearestIndexTo2020());
    await page.keyboard.down('ArrowUp');
    const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    let counted = 0;
    // Poll in real time: under load the browser can step several sim seconds per frame.
    for (;;) {
      await page.waitForTimeout(50);
      const simTime = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
      if (simTime > t0 + 5.5) break;
      counted++;
      const surface = await page.evaluate(() => window.__SIMGAME__!.surfaceUnderCar());
      expect(surface, `sample ${counted} at t+${(simTime - t0).toFixed(2)}s`).toBe('asphalt');
    }
    expect(counted).toBeGreaterThanOrEqual(3);
    await page.keyboard.up('ArrowUp');
    const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
    expect(speed).toBeGreaterThan(30);
  });
});

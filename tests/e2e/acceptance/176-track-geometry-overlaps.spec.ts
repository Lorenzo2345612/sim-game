import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('176 track geometry overlaps', () => {
  test('AT7: surface under the car is asphalt or kerb at singapore indices 250, 975, 1000 and 1375', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=singapore');
    for (const i of [250, 975, 1000, 1375]) {
      await page.evaluate((idx) => window.__SIMGAME__!.teleportToIndex(idx), i);
      const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
      await page.waitForFunction((t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t + 0.2, t0, {
        timeout: 60000,
      });
      const surface = await page.evaluate(() => window.__SIMGAME__!.surfaceUnderCar());
      expect(['asphalt', 'kerb'], `index ${i}`).toContain(surface);
    }
  });
});

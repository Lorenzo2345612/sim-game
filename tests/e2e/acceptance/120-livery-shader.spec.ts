import { expect, test, type Page } from '@playwright/test';
import type { Livery } from '../../../src/game/livery';

test.use({ viewport: { width: 1280, height: 720 } });

type Stats120 = {
  carScreenRect: { x: number; y: number; w: number; h: number };
  liveryPrimary: string;
};
type Debug120 = {
  setLivery(l: Partial<Livery>): void;
  sceneStats(): Stats120;
};

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

test.describe('120 livery shader', () => {
  // No pixel sampling: headless swiftshader renders lit geometry black, also on approved builds.
  test('AT4: setLivery primary #ff0000 then #0000ff updates the shader uniform and the car stays on screen', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    for (const primary of ['#ff0000', '#0000ff']) {
      await page.evaluate((c) => {
        (window.__SIMGAME__ as unknown as Debug120).setLivery({ primary: c });
      }, primary);
      const { carScreenRect, liveryPrimary } = await page.evaluate(() =>
        (window.__SIMGAME__ as unknown as Debug120).sceneStats(),
      );
      expect(liveryPrimary).toBe(primary);
      expect(carScreenRect.w).toBeGreaterThan(0);
      expect(carScreenRect.h).toBeGreaterThan(0);
      expect(carScreenRect.x).toBeGreaterThanOrEqual(0);
      expect(carScreenRect.y).toBeGreaterThanOrEqual(0);
      expect(carScreenRect.x + carScreenRect.w).toBeLessThanOrEqual(1280);
      expect(carScreenRect.y + carScreenRect.h).toBeLessThanOrEqual(720);
    }
  });
});

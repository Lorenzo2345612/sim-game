import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type Debug158 = {
  sceneStats(): { buildings?: number };
};

test.describe('158 no-env track', () => {
  test('monza (no -env.json) loads with buildings 0 and no page errors', async ({ page }) => {
    test.setTimeout(120000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto('/?track=monza');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
      timeout: 60000,
    });
    const stats = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug158).sceneStats(),
    );
    expect(stats.buildings).toBe(0);
    expect(pageErrors).toEqual([]);
  });
});

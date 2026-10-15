import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('173 pit building on the straight', () => {
  test('AT5: at lusail sceneStats().pitBuildings equals 1', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=lusail');
    const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
    expect(stats.pitBuildings).toBe(1);
  });
});

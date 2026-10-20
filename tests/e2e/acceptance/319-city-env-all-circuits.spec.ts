import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('319 city env all circuits', () => {
  test('AT4: mexico sceneStats().buildings > 0 5 s after load, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=mexico');
    await page.waitForTimeout(5000); // let the async env fetch and texture loads finish
    const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
    expect(stats.buildings).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});

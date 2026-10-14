import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 102 adds groundTexture to SceneStats; the global type only gains it when
// the task is implemented.
type Stats102 = { sceneStats(): { groundTexture?: string | null } };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('102 satellite ground', () => {
  test('AT3: monza reports the ground texture from textures/ground/monza.jpg, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    await page.waitForTimeout(2000); // let the async texture requests finish
    const stats = await page.evaluate(() => (window.__SIMGAME__ as unknown as Stats102).sceneStats());
    expect(stats.groundTexture).toMatch(/textures\/ground\/monza\.jpg$/);
    expect(errors).toEqual([]);
  });
});

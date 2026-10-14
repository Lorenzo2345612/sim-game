import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 141 adds foamBlocks and escapeRoads to SceneStats; until src/main.ts is
// updated the debug handle is accessed through a local mirror type.
type Stats141 = { foamBlocks: number; escapeRoads: number };
type Debug141 = { sceneStats(): Stats141; drawCalls(): number };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('141 escape road and foam acceptance', () => {
  test('AT4: monza reports foam blocks and at least one escape road in sceneStats with drawCalls <= 300 and no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const stats = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug141).sceneStats());
    expect(stats.foamBlocks).toBeGreaterThan(0);
    expect(stats.escapeRoads).toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug141).drawCalls())).toBeLessThanOrEqual(300);
    expect(errors).toEqual([]);
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

// lamps/sidewalks land in SceneStats with task 159; the cast keeps typecheck green.
type Stats159 = { lamps: number; sidewalks: number };
type Debug159 = { sceneStats(): Stats159 };

async function sceneStats(page: Page): Promise<Stats159> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug159).sceneStats());
}

test.describe('159 street circuit trackside', () => {
  test('AT3: at ready lasvegas reports lamps > 0 and sidewalks > 0 with drawCalls <= 300', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=lasvegas');
    const stats = await sceneStats(page);
    expect(stats.lamps).toBeGreaterThan(0);
    expect(stats.sidewalks).toBeGreaterThan(0);
    const calls = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    expect(calls, 'draw calls').toBeLessThanOrEqual(300);
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 150 adds sausages to SceneStats; until src/main.ts is updated the debug
// handle is accessed through a local mirror type (the 141 pattern).
type Stats150 = { sausages: number };
type Debug150 = { sceneStats(): Stats150 };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('150 sausage kerb render and colliders acceptance', () => {
  test('AT3: monza ready reports sceneStats.sausages equal to the count in monza.json with no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const track = (await (await page.request.get('/tracks/monza.json')).json()) as {
      sausages?: unknown[];
    };
    const expected = (track.sausages ?? []).length;
    const stats = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug150).sceneStats());
    expect(stats.sausages).toBe(expected);
    expect(errors).toEqual([]);
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 143 adds distanceBoards to SceneStats and boards to the track JSON;
// the global types only gain them when the task is implemented.
type Stats143 = { sceneStats(): { distanceBoards?: number }; drawCalls(): number };
type TrackJson143 = { boards?: unknown[] };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render before reading drawCalls()
}

async function trackJson(page: Page, id: string): Promise<TrackJson143> {
  const res = await page.request.get(`/tracks/${id}.json`);
  return (await res.json()) as TrackJson143;
}

test.describe('143 distance boards e2e', () => {
  test('AT5: at monza sceneStats().distanceBoards equals the boards in monza.json, drawCalls stays ≤ 300 and there are no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const distanceBoards = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Stats143).sceneStats().distanceBoards,
    );
    const drawCalls = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Stats143).drawCalls(),
    );
    const track = await trackJson(page, 'monza');
    expect(distanceBoards).toBe((track.boards ?? []).length);
    expect(drawCalls).toBeLessThanOrEqual(300);
    expect(errors).toEqual([]);
  });
});

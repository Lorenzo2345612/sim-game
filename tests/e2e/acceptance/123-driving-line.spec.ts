import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 123 adds drivingLine to SceneStats; the global types only gain it when the task is implemented.
type Stats123 = {
  sceneStats(): { drivingLine: { visible: boolean; vertexCount: number } };
};
type TrackJson123 = { centerline: [number, number][] };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function trackJson(page: Page, id: string): Promise<TrackJson123> {
  const res = await page.request.get(`/tracks/${id}.json`);
  return (await res.json()) as TrackJson123;
}

test.describe('123 driving line overlay e2e', () => {
  test('AT3: at monza with ?line=full the driving line is visible with vertex count ≥ 2 × line points', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&line=full');
    const drivingLine = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Stats123).sceneStats().drivingLine,
    );
    const track = await trackJson(page, 'monza');
    const linePoints = track.centerline.length;
    expect(drivingLine.visible).toBe(true);
    expect(drivingLine.vertexCount).toBeGreaterThanOrEqual(2 * linePoints);
    expect(errors).toEqual([]);
  });

  test('AT4: at monza with ?line=off the driving line is not visible', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&line=off');
    const drivingLine = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Stats123).sceneStats().drivingLine,
    );
    expect(drivingLine.visible).toBe(false);
    expect(errors).toEqual([]);
  });
});

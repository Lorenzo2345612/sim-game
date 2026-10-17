import { expect, test, type Page } from '@playwright/test';

type Stats = { sceneStats(): { floodlights: number } };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 120000 });
}

async function floodlights(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Stats).sceneStats().floodlights);
}

test.describe('186 floodlights e2e', () => {
  test('AT9: a floodlight style places poles on monza; without the route the scene has none', async ({ page }) => {
    test.setTimeout(240000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/tracks/monza.style.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"version":1,"floodlights":{"spacingMeters":40}}',
      }),
    );
    await loadGame(page, '/?track=monza');
    expect(await floodlights(page)).toBeGreaterThan(0);
    expect(errors).toEqual([]);

    // Sequential loads: a second unthrottled SwiftShader loop starves the next page.
    const context = page.context();
    await page.close();

    const bare = await context.newPage();
    await loadGame(bare, '/?track=monza');
    expect(await floodlights(bare)).toBe(0);
    await bare.close();
  });
});

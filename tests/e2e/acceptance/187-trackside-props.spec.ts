import { expect, test, type Page } from '@playwright/test';

type Stats = { sceneStats(): { props: number } };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function props(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Stats).sceneStats().props);
}

test.describe('187 trackside props e2e', () => {
  test('AT9: a footbridge style places one prop on monza; a style without props places none', async ({ page }) => {
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
        body: '{"version":1,"props":[{"type":"footbridge","index":10,"offsetMeters":12,"heightMeters":7,"color":"#1f9a6a"}]}',
      }),
    );
    await loadGame(page, '/?track=monza');
    expect(await props(page)).toBe(1);
    expect(errors).toEqual([]);
    const bare = await page.context().newPage();
    await bare.route('**/tracks/monza.style.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1}' }),
    );
    await loadGame(bare, '/?track=monza');
    expect(await props(bare)).toBe(0);
    await bare.close();
  });
});

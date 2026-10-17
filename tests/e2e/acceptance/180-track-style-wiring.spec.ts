import { expect, test, type Page } from '@playwright/test';

interface StyleInfo { id: string; loaded: boolean; warnings: number; extraGrandstands: number }
type Stats = { sceneStats(): { style: StyleInfo; grandstands: number } };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function stats(page: Page): Promise<{ style: StyleInfo; grandstands: number }> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Stats).sceneStats());
}

test.describe('180 track style wiring e2e', () => {
  test('AT10: a missing style file reports loaded false', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**/tracks/monza.style.json', (route) => route.fulfill({ status: 404, body: '' }));
    await loadGame(page, '/?track=monza');
    expect((await stats(page)).style).toEqual({ id: 'monza', loaded: false, warnings: 0, extraGrandstands: 0 });
  });

  test('AT11: a style with an unknown key reports loaded true and one warning', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**/tracks/monza.style.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1,"foo":1}' }),
    );
    await loadGame(page, '/?track=monza');
    expect((await stats(page)).style).toEqual({ id: 'monza', loaded: true, warnings: 1, extraGrandstands: 0 });
  });

  test('AT12: extra grandstands are counted separately from track grandstands', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/tracks/monza.style.json', (route) => route.fulfill({ status: 404, body: '' }));
    await loadGame(page, '/?track=monza');
    const baseline = await stats(page);
    const styled = await page.context().newPage();
    await styled.route('**/tracks/monza.style.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"version":1,"extraGrandstands":[{"start":100,"end":130,"side":"left"}]}',
      }),
    );
    await loadGame(styled, '/?track=monza');
    const result = await stats(styled);
    expect(result.style.extraGrandstands).toBe(1);
    expect(result.grandstands).toBe(baseline.grandstands);
    await styled.close();
  });
});

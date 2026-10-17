import { expect, test, type Page } from '@playwright/test';

type Stats = { sceneStats(): { kerbOuterStripMeters: number } };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function meters(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Stats).sceneStats().kerbOuterStripMeters);
}

test.describe('206 kerb outer strip e2e', () => {
  test('AT7: the route style builds outer strips; without it kerbOuterStripMeters is 0', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/tracks/budapest.style.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1,"kerbs":{"outerStrip":"#2e8b57"}}' }),
    );
    await loadGame(page, '/?track=budapest');
    expect(await meters(page)).toBeGreaterThan(0);
    const styled = await page.context().newPage();
    await styled.route('**/tracks/budapest.style.json', (route) => route.fulfill({ status: 404, body: '' }));
    await loadGame(styled, '/?track=budapest');
    expect(await meters(styled)).toBe(0);
    await styled.close();
  });
});

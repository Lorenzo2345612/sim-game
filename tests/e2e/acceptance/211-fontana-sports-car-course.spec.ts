import { expect, test, type Page } from '@playwright/test';

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('211 fontana sports car course', () => {
  test('AT8: /?track=fontana-roval reaches ready with no console errors and asphalt under the car', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=fontana-roval');
    expect(await page.evaluate(() => window.__SIMGAME__?.ready)).toBe(true);
    expect(errors).toEqual([]);
    const surface = await page.evaluate(() => window.__SIMGAME__!.surfaceUnderCar());
    expect(surface).toBe('asphalt');
  });
});

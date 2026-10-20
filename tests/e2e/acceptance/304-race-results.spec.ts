import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('304 race results', () => {
  test('AT8: results overlay shows Running cars, no DNF, and the sim keeps running', async ({ page }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?race=1&track=cleveland&ai=3&laps=3');
    await page.waitForFunction(() => window.__SIMGAME__!.startLights() === 0 && window.__SIMGAME__!.getSimTime() > 0, undefined, {
      timeout: 60000,
    });
    const goTime = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    await page.waitForFunction((t) => window.__SIMGAME__!.getSimTime() >= t + 3, goTime, { timeout: 60000 });
    await page.evaluate(() => window.__SIMGAME__!.finishRaceNow!());
    await expect(page.locator('#results')).toBeVisible();
    const cells = await page.locator('#results .results-pane').first().locator('tbody td').allInnerTexts();
    expect(cells).not.toContain('DNF');
    expect(cells.filter((c) => c === 'Running').length).toBeGreaterThanOrEqual(3);
    const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    await page.waitForFunction((t) => window.__SIMGAME__!.getSimTime() >= t + 1, t0, { timeout: 5000 });
    expect(errors).toEqual([]);
  });
});

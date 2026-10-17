import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// sceneStats().fogDensity arrives with task 184 (SceneStats in src/main.ts).
interface Debug184 {
  sceneStats(): { fogDensity: number };
}

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 120000 });
}

function fogDensity(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug184).sceneStats().fogDensity);
}

test.describe('184 palette edge sky style e2e', () => {
  test('AT7: sky.fogDensityScale 2 doubles the monza scene fog density', async ({ page }) => {
    test.setTimeout(240000);
    await page.route('**/tracks/monza.style.json', (route) => route.fulfill({ status: 404, body: '' }));
    await loadGame(page, '/?track=monza');
    const baseline = await fogDensity(page);
    expect(baseline).toBeGreaterThan(0);

    // Sequential loads: a second unthrottled SwiftShader loop starves the next page.
    const context = page.context();
    await page.close();

    const errors: string[] = [];
    const styled = await context.newPage();
    styled.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    styled.on('pageerror', (e) => errors.push(e.message));
    await styled.route('**/tracks/monza.style.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"version":1,"sky":{"fogDensityScale":2}}',
      }),
    );
    await loadGame(styled, '/?track=monza');
    const scaled = await fogDensity(styled);
    await styled.close();

    expect(errors).toEqual([]);
    expect(Math.abs(scaled - 2 * baseline)).toBeLessThanOrEqual(1e-9);
  });
});

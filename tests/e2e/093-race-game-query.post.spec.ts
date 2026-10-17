import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type RaceHooks = {
  carCount(): number;
  startLights(): number;
};

async function carCount(page: Page, path: string): Promise<number> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  return page.evaluate(() => (window.__SIMGAME__ as unknown as RaceHooks).carCount());
}

test.describe('093 race query parameters', () => {
  test('ai is clamped to 0..15 and invalid values fall back to the default', async ({ page }) => {
    test.setTimeout(180000);
    expect(await carCount(page, '/?race=1&track=monza&ai=0'), 'ai=0').toBe(1);
    expect(await carCount(page, '/?race=1&track=monza&ai=99'), 'ai=99 clamps to 15').toBe(16);
    expect(await carCount(page, '/?race=1&track=monza&ai=-2'), 'ai=-2 clamps to 0').toBe(1);
    expect(await carCount(page, '/?race=1&track=monza&ai=not-a-number'), 'ai=not-a-number').toBe(6);
  });

  test('an empty ai value falls back to the default of 5', async ({ page }) => {
    test.setTimeout(120000);
    expect(await carCount(page, '/?race=1&track=monza&ai='), 'ai= empty').toBe(6);
  });
});

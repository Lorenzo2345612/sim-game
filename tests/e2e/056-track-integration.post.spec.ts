import { expect, test } from '@playwright/test';

test.describe('056 track integration gaps', () => {
  test('POSTE1: an unknown ?track= value falls back to monza without errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?track=nurburgring');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    const id = await page.evaluate(() => window.__SIMGAME__!.trackId());
    expect(id).toBe('monza');
    expect(errors).toEqual([]);
  });
});

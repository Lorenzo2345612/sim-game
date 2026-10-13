import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

test.describe('081 terrain material', () => {
  test('AT6: spa reaches ready with no console errors and no HTTP 404 for any /textures/ request', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    const missing: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (res) => {
      if (res.status() === 404 && res.url().includes('/textures/')) missing.push(res.url());
    });
    await page.goto('/?track=spa');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
    await page.waitForTimeout(2000); // let the async texture requests finish
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
  });
});

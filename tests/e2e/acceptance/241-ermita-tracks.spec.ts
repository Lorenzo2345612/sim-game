import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

test.describe('241 ermita tracks', () => {
  test('AT9: selecting Ermita Federal starts a race with a rendering canvas, no console errors and a speed reading', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    await page.click('button[data-track="ermita-federal"]');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
    expect(await page.evaluate(() => window.__SIMGAME__!.trackId())).toBe('ermita-federal');
    await page.waitForTimeout(3000);
    await expect(page.locator('#game')).toBeVisible();
    expect(await page.evaluate(() => window.__SIMGAME__!.drawCalls())).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(await page.locator('#hud').innerText()).toContain('km/h');
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const PREVIOUS_COUNT = 28;

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('336 longbeach in game', () => {
  test('AT1: the button after miami is longbeach named Long Beach and total = previous + 1', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    const ids = await page
      .locator('#menu button[data-track]')
      .evaluateAll((els) => els.map((el) => (el as HTMLButtonElement).getAttribute('data-track') ?? ''));
    expect(ids.length, 'total buttons').toBe(PREVIOUS_COUNT + 1);
    expect(ids[PREVIOUS_COUNT - 1], 'button before').toBe('miami');
    expect(ids[PREVIOUS_COUNT]).toBe('longbeach');
    const names = await page.locator('#menu button[data-track] .track-name').allTextContents();
    expect(names[PREVIOUS_COUNT]).toBe('Long Beach');
  });

  test('AT2: longbeach loads, no console errors, over 30 km/h after 3 s of throttle', async ({ page }) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=longbeach');
    expect(await page.evaluate(() => window.__SIMGAME__!.trackId())).toBe('longbeach');
    await page.keyboard.down('ArrowUp');
    const start = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    await page.waitForFunction((from) => (window.__SIMGAME__?.getSimTime() ?? 0) - from >= 3, start, {
      timeout: 60000,
    });
    await page.keyboard.up('ArrowUp');
    expect(await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh())).toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  test('AT3: longbeach reports city environment and satellite ground texture', async ({ page }) => {
    test.setTimeout(300000);
    await loadGame(page, '/?track=longbeach');
    const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
    expect(stats.environmentType).toBe('city');
    expect(stats.groundTexture).toContain('textures/ground/longbeach.jpg');
  });
});

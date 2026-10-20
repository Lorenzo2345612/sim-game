import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

type Rect = { width: number; height: number; top: number; right: number };

async function canvasRects(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate((sel) => {
    return Array.from(document.querySelectorAll<HTMLCanvasElement>(sel)).map((canvas) => {
      const r = canvas.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top, right: r.right };
    });
  }, selector);
}

test.describe('161 minimap size and pause audio', () => {
  test('AT1: exactly one canvas besides #game, 160 px square in the top-right corner', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const rects = await canvasRects(page, 'canvas:not(#game):not(#mirror)');
    expect(rects.length).toBe(1);
    const minimap = rects[0];
    expect(minimap.width).toBeGreaterThanOrEqual(159);
    expect(minimap.width).toBeLessThanOrEqual(161);
    expect(minimap.height).toBeGreaterThanOrEqual(159);
    expect(minimap.height).toBeLessThanOrEqual(161);
    expect(minimap.right).toBeGreaterThanOrEqual(1280 - 24);
    expect(minimap.top).toBeLessThanOrEqual(24);
  });

  test('AT2: the #game canvas fills the 1280 × 720 viewport', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const rects = await canvasRects(page, '#game');
    expect(rects.length).toBe(1);
    const game = rects[0];
    expect(game.width).toBeGreaterThanOrEqual(1279);
    expect(game.width).toBeLessThanOrEqual(1281);
    expect(game.height).toBeGreaterThanOrEqual(719);
    expect(game.height).toBeLessThanOrEqual(721);
  });

  test('AT6: Escape reports audioPaused() true, Escape again reports false', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__SIMGAME__!.audioPaused())).toBe(true);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__SIMGAME__!.audioPaused())).toBe(false);
  });
});

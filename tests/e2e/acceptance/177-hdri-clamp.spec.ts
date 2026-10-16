import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

// Fraction of region x 300-980, y 400-640 with luminance < 8/255 (channels 0-255).
async function darkFraction(page: Page, pngBase64: string): Promise<number> {
  return page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(300, 400, 680, 240).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (lum < 8) dark += 1;
    }
    return dark / (680 * 240);
  }, pngBase64);
}

test.describe('177 hdri half-float clamp', () => {
  test('AT4: monza lit region has < 50 % near-black pixels 2 s after ready', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.waitForTimeout(2000);
    const png = (await page.screenshot()).toString('base64');
    expect(await darkFraction(page, png)).toBeLessThan(0.5);
  });

  test('AT5: lusail lit region has < 50 % near-black pixels 2 s after ready', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=lusail');
    await page.waitForTimeout(2000);
    const png = (await page.screenshot()).toString('base64');
    expect(await darkFraction(page, png)).toBeLessThan(0.5);
  });

  test('AT6: monza sceneStats().horizonColor channels are finite and within [0, 1]', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const horizon = await page.evaluate(() => window.__SIMGAME__!.sceneStats().horizonColor);
    for (const c of horizon) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

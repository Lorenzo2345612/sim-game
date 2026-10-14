import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Start grandstand (roofed, right of the monza start straight) at the default chase view.
const GRANDSTAND_REGION = { x: 1140, y: 150, width: 140, height: 140 };

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render (textures, shadows)
}

async function luminanceStdDev(page: Page, pngBase64: string): Promise<number> {
  return page.evaluate(
    async ({ png, rx, ry, rw, rh }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(rx, ry, rw, rh).data;
      const luminance: number[] = [];
      for (let i = 0; i < d.length; i += 4) {
        luminance.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
      }
      const mean = luminance.reduce((a, b) => a + b, 0) / luminance.length;
      const variance = luminance.reduce((a, b) => a + (b - mean) ** 2, 0) / luminance.length;
      return Math.sqrt(variance);
    },
    { png: pngBase64, rx: GRANDSTAND_REGION.x, ry: GRANDSTAND_REGION.y, rw: GRANDSTAND_REGION.width, rh: GRANDSTAND_REGION.height },
  );
}

test.describe('104 crowd', () => {
  test('AT4: monza ready keeps drawCalls <= 300 and the start grandstand screenshot region has luminance std dev >= 0.05', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    expect(await page.evaluate(() => window.__SIMGAME__!.drawCalls())).toBeLessThanOrEqual(300);
    const png = (await page.screenshot()).toString('base64');
    expect(await luminanceStdDev(page, png)).toBeGreaterThanOrEqual(0.05);
  });
});

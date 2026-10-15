import { expect, test, type Page } from '@playwright/test';
import type { Livery } from '../../../src/game/livery';

test.use({ viewport: { width: 1280, height: 720 } });

type Rgb = { r: number; g: number; b: number };
type CarScreenRect = { x: number; y: number; w: number; h: number };
type Debug120 = {
  setLivery(l: Partial<Livery>): void;
  sceneStats(): { carScreenRect: CarScreenRect };
};

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function samplePixel(page: Page, pngBase64: string, x: number, y: number): Promise<Rgb> {
  return page.evaluate(
    async ({ png, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    },
    { png: pngBase64, px: x, py: y },
  );
}

async function bodyPixel(page: Page, primary: string): Promise<Rgb> {
  await page.evaluate((c) => {
    (window.__SIMGAME__ as unknown as Debug120).setLivery({ primary: c });
  }, primary);
  await page.waitForTimeout(500);
  const rect = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug120).sceneStats().carScreenRect);
  const png = (await page.screenshot()).toString('base64');
  return samplePixel(page, png, Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2));
}

test.describe('120 livery shader', () => {
  test('AT4: setLivery primary #ff0000 then #0000ff flips the car-body pixel from red-dominant to blue-dominant', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const red = await bodyPixel(page, '#ff0000');
    expect(red.r).toBeGreaterThan(red.g);
    expect(red.r).toBeGreaterThan(red.b);
    const blue = await bodyPixel(page, '#0000ff');
    expect(blue.b).toBeGreaterThan(blue.r);
    expect(blue.b).toBeGreaterThan(blue.g);
  });
});

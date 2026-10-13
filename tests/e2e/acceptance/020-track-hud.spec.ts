import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page): Promise<void> {
  await page.goto('/?track=monza');
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

type Rgb = { r: number; g: number; b: number };

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

function expectAsphalt(rgb: Rgb): void {
  expect(rgb.r).toBeLessThan(90);
  expect(rgb.g).toBeLessThan(90);
  expect(rgb.b).toBeLessThan(90);
  expect(rgb.g - rgb.r).toBeLessThan(25);
}

test.describe('track visibility and HUD position', () => {
  test('AT1: road just below the car renders as asphalt', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const png = (await page.screenshot()).toString('base64');
    expectAsphalt(await samplePixel(page, png, 640, 690));
  });

  test('AT2: road ahead of the car renders as asphalt', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const png = (await page.screenshot()).toString('base64');
    expectAsphalt(await samplePixel(page, png, 640, 330));
  });

  test('AT3: HUD panel is visible at the top-left of the viewport', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const rect = await page.locator('#hud').boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeLessThanOrEqual(40);
    expect(rect!.y).toBeLessThanOrEqual(40);
    expect(rect!.width).toBeGreaterThan(50);
    expect(rect!.height).toBeGreaterThan(20);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(1280);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(720);
  });

  test('AT4: HUD shows speed unit and lap field', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    const text = await page.locator('#hud').innerText();
    expect(text).toContain('km/h');
    expect(text).toContain('Lap');
  });

  test('AT5: speed in HUD exceeds 50 km/h after 3 s of throttle', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3000);
    await page.keyboard.up('ArrowUp');
    const text = await page.locator('#hud').innerText();
    const match = text.match(/([\d.]+)\s*km\/h/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeGreaterThan(50);
  });
});

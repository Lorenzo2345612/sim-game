import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render through the chain
}

async function diffFraction(page: Page, pngA: string, pngB: string): Promise<number> {
  return page.evaluate(async ([a, b]) => {
    const load = async (png: string): Promise<ImageData> => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height);
    };
    const da = (await load(a)).data;
    const db = (await load(b)).data;
    if (da.length !== db.length) return 1;
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++;
    }
    return diff / (da.length / 4);
  }, [pngA, pngB]);
}

test.describe('105 post-processing tiers', () => {
  test('AT3: medium differs from low in at least 2% of pixels and both loads have no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&quality=low');
    const low = (await page.screenshot()).toString('base64');
    await loadGame(page, '/?track=monza&quality=medium');
    const medium = (await page.screenshot()).toString('base64');
    expect(await diffFraction(page, low, medium)).toBeGreaterThanOrEqual(0.02);
    expect(errors).toEqual([]);
  });
});

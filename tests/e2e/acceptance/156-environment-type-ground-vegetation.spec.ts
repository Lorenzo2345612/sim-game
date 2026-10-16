import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

type Stats156 = { environmentType: string; treeSpecies: string[] };
type Debug156 = { sceneStats(): Stats156 };

async function sceneStats(page: Page): Promise<Stats156> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug156).sceneStats());
}

test.describe('156 environment type ground vegetation', () => {
  test('AT3: bahrain reports environmentType desert with palm-date in treeSpecies and no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=bahrain');
    const stats = await sceneStats(page);
    expect(stats.environmentType).toBe('desert');
    expect(stats.treeSpecies).toContain('palm-date');
    expect(errors).toEqual([]);
  });

  test('AT4: monza reports environmentType parkland with no palm in treeSpecies', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const stats = await sceneStats(page);
    expect(stats.environmentType).toBe('parkland');
    expect(stats.treeSpecies.filter((s) => s.startsWith('palm'))).toEqual([]);
  });

  test('AT5: the side strips x < 384 or x >= 896 of the ground band y 400-719 of the bahrain start view are sand-toned', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=bahrain');
    await page.waitForTimeout(1000); // first frames settle: vegetation and textures ready
    const png = (await page.screenshot()).toString('base64');
    const { redRatio, meanSaturation } = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const top = 400;
      const d = ctx.getImageData(0, top, img.width, img.height - top).data;
      let red = 0;
      let saturated = 0;
      let satSum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const x = (i / 4) % img.width;
        if (x >= 384 && x < 896) continue; // centre strip: car and horizon
        const r = d[i] / 255;
        const g = d[i + 1] / 255;
        const b = d[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max > 0 ? (max - min) / max : 0;
        satSum += sat;
        n++;
        if (sat >= 0.12) {
          saturated++;
          if (r > g) red += 1;
        }
      }
      return { redRatio: saturated > 0 ? red / saturated : 0, meanSaturation: satSum / n };
    }, png);
    expect(redRatio).toBeGreaterThanOrEqual(0.4);
    expect(meanSaturation).toBeLessThan(0.45);
  });
});

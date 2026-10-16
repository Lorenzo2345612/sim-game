import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 158 adds buildings to SceneStats; the global declaration only gains it once implemented.
type Debug158 = {
  sceneStats(): { buildings?: number };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('158 city renderer', () => {
  test('AT3: singapore sceneStats().buildings equals the env file count, drawCalls <= 300, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=singapore');
    await page.waitForTimeout(2000); // let the async env fetch and texture loads finish
    const envBuildings = await page.evaluate(async () => {
      const res = await fetch('/tracks/singapore-env.json');
      const data = (await res.json()) as { buildings: unknown[] };
      return data.buildings.length;
    });
    const stats = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug158).sceneStats(),
    );
    expect(stats.buildings).toBe(envBuildings);
    const drawCalls = await page.evaluate(() => window.__SIMGAME__!.drawCalls());
    expect(drawCalls).toBeLessThanOrEqual(300);
    expect(errors).toEqual([]);
  });

  test('AT4: at the baku start >= 25% of band y 120-260 differs from the row sky colour by > 0.1', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=baku');
    await page.waitForTimeout(2000); // let the city build and textures load
    const png = (await page.screenshot()).toString('base64');
    const fraction = await page.evaluate(async (image) => {
      const img = new Image();
      img.src = `data:image/png;base64,${image}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const top = 120;
      const bottom = 260;
      const { data, width } = ctx.getImageData(0, top, img.width, bottom - top + 1);
      const luma = (i: number): number =>
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      let nonSky = 0;
      let total = 0;
      for (let y = 0; y <= bottom - top; y++) {
        let sum = 0;
        for (let x = 0; x < width; x++) sum += luma((y * width + x) * 4);
        const sky = sum / width; // the row's sky colour
        for (let x = 0; x < width; x++) {
          if (Math.abs(luma((y * width + x) * 4) - sky) > 0.1) nonSky++;
          total++;
        }
      }
      return nonSky / total;
    }, png);
    expect(fraction).toBeGreaterThanOrEqual(0.25);
  });
});

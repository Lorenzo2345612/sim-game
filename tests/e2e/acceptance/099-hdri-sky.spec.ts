import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type SceneStats099 = {
  environment: string;
  ibl: boolean;
  horizonColor: [number, number, number];
  fogColor: [number, number, number];
};

// Task 099 adds environment/ibl/horizonColor/fogColor to sceneStats and a new
// renderStats(); the global declaration in src/main.ts only gains them once implemented.
type Debug099 = {
  sceneStats(): SceneStats099;
  renderStats(): { toneMapping: string };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render the HDRI background
}

function sceneStats(page: Page): Promise<SceneStats099> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug099).sceneStats());
}

function renderStats(page: Page): Promise<{ toneMapping: string }> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug099).renderStats());
}

async function skyBandVariation(page: Page): Promise<number> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (image) => {
    const img = new Image();
    img.src = `data:image/png;base64,${image}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const rows = 151; // sky band y 0..150 inclusive
    const { data } = ctx.getImageData(0, 0, img.width, rows);
    const luma = (i: number): number =>
      (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    let varied = 0;
    let total = 0;
    for (let y = 0; y < rows; y++) {
      let sum = 0;
      for (let x = 0; x < img.width; x++) sum += luma((y * img.width + x) * 4);
      const mean = sum / img.width;
      for (let x = 0; x < img.width; x++) {
        if (Math.abs(luma((y * img.width + x) * 4) - mean) > 0.03) varied++;
        total++;
      }
    }
    return varied / total;
  }, png);
}

test.describe('099 hdri sky', () => {
  test('AT1: monza uses the partly cloudy HDRI with IBL and Neutral tone mapping, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const stats = await sceneStats(page);
    expect(stats.environment).toBe('kloofendal_48d_partly_cloudy_puresky');
    expect(stats.ibl).toBe(true);
    const { toneMapping } = await renderStats(page);
    expect(toneMapping).toBe('Neutral');
    expect(errors).toEqual([]);
  });

  test('AT2: at monza at least 5% of sky-band pixels deviate from their row mean luminance by > 0.03', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    expect(await skyBandVariation(page)).toBeGreaterThanOrEqual(0.05);
  });

  test('AT4: spa uses the overcast HDRI and fog color matches horizonColor within 0.02 per channel', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    const stats = await sceneStats(page);
    expect(stats.environment).toBe('kloofendal_overcast_puresky');
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(stats.fogColor[i] - stats.horizonColor[i])).toBeLessThanOrEqual(0.02);
    }
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// SceneStats gains timeOfDay/sunElevationDeg once task 135 is implemented; the
// global declaration in src/main.ts only gains them then.
type SceneStats135 = {
  timeOfDay: string;
  sunElevationDeg: number;
  environment: string;
};
type Debug135 = { sceneStats(): SceneStats135 };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render the HDRI background
}

function sceneStats(page: Page): Promise<SceneStats135> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug135).sceneStats());
}

async function skyBandMeanLuminance(page: Page): Promise<number> {
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
    const n = img.width * rows;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const off = i * 4;
      sum += (0.2126 * data[off] + 0.7152 * data[off + 1] + 0.0722 * data[off + 2]) / 255;
    }
    return sum / n;
  }, png);
}

test.describe('135 time of day', () => {
  test('AT1: lusail defaults to night with the night HDRI, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=lusail');
    const stats = await sceneStats(page);
    expect(stats.timeOfDay).toBe('night');
    expect(stats.environment).toBe('tod_night');
    expect(errors).toEqual([]);
  });

  test('AT2: ?track=monza&tod=sunset selects sunset with sun elevation < 15°', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&tod=sunset');
    const stats = await sceneStats(page);
    expect(stats.timeOfDay).toBe('sunset');
    expect(stats.sunElevationDeg).toBeLessThan(15);
    expect(errors).toEqual([]);
  });

  test('AT3: night sky-band mean luminance is under 0.3× the day one, no console errors', async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const day = await skyBandMeanLuminance(page);
    await loadGame(page, '/?track=monza&tod=night');
    const night = await skyBandMeanLuminance(page);
    expect(night).toBeLessThan(0.3 * day);
    expect(errors).toEqual([]);
  });
});

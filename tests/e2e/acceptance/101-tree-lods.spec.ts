import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // first frames: draw calls and tree LODs settle
}

async function trackTreeCount(page: Page, id: string): Promise<number> {
  const res = await page.request.get(`/tracks/${id}.json`);
  expect(res.ok()).toBe(true);
  const track = (await res.json()) as { trees: { data: number[] }[] };
  return track.trees.reduce((n, batch) => n + Math.floor(batch.data.length / 4), 0);
}

test.describe('101 tree lods', () => {
  test('AT2: spa reports the tree count of spa.json and draws at most 300 calls', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    const [instances, expected, calls] = await Promise.all([
      page.evaluate(() => window.__SIMGAME__!.sceneStats().treeInstances),
      trackTreeCount(page, 'spa'),
      page.evaluate(() => window.__SIMGAME__!.drawCalls()),
    ]);
    expect(instances).toBe(expected);
    expect(calls).toBeLessThanOrEqual(300);
  });

  test('AT3: the band y 200-330 of the spa start view is textured foliage', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=spa');
    const png = (await page.screenshot()).toString('base64');
    const { fraction, std } = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 200, img.width, 131).data; // y 200..330 inclusive
      let matching = 0;
      let sum = 0;
      let sumSq = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (g > r && luminance < 0.5) matching += 1;
        sum += luminance;
        sumSq += luminance * luminance;
      }
      const mean = sum / n;
      return { fraction: matching / n, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
    }, png);
    expect(fraction).toBeGreaterThanOrEqual(0.3);
    expect(std).toBeGreaterThanOrEqual(0.04);
  });
});

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type SceneStats = {
  barriers: number;
  treeInstances: number;
  grandstands: number;
  pitBuildings: number;
  startGantries: number;
  sky: boolean;
  shadows: boolean;
};

// Task 043 extends window.__SIMGAME__ with sceneStats()/drawCalls(); the global
// declaration in src/main.ts only gains them when the task is implemented.
type Debug043 = { sceneStats(): SceneStats; drawCalls(): number };

type TrackV2 = {
  trees: { species: string; data: number[] }[]; // data = flat [x, z, scale, rotY] per instance
  grandstands: unknown[];
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  await page.waitForTimeout(1000); // let frames render (shadows, tree LOD, textures)
}

function sceneStats(page: Page): Promise<SceneStats> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug043).sceneStats());
}

function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug043).drawCalls());
}

async function trackJson(page: Page, id: string): Promise<TrackV2> {
  const res = await page.request.get(`/tracks/${id}.json`);
  expect(res.ok()).toBe(true);
  return res.json() as Promise<TrackV2>;
}

function treeInstances(track: TrackV2): number {
  return track.trees.reduce((n, batch) => n + Math.floor(batch.data.length / 4), 0);
}

test.describe('043 world integration', () => {
  test('AT1: sceneStats at monza reports the scenery counts, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const [stats, track] = await Promise.all([sceneStats(page), trackJson(page, 'monza')]);
    expect(stats.barriers).toBeGreaterThan(0);
    expect(stats.treeInstances).toBe(treeInstances(track));
    expect(stats.grandstands).toBe(track.grandstands.length);
    expect(stats.pitBuildings).toBe(1);
    expect(stats.startGantries).toBe(1);
    expect(errors).toEqual([]);
  });

  test('AT2: trees are visible from the monza start line in the band y 200-280, x < 300', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const png = (await page.screenshot()).toString('base64');
    const fraction = await page.evaluate(async (pngBase64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${pngBase64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 200, 300, 81).data; // y 200..280 inclusive, x 0..299
      let matching = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (g > r && luminance < 0.5) matching += 1;
      }
      return matching / (d.length / 4);
    }, png);
    expect(fraction).toBeGreaterThanOrEqual(0.3);
  });

  test('AT3: drawCalls at monza is at most 300', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    expect(await drawCalls(page)).toBeLessThanOrEqual(300);
  });

  test('AT4: spa loads with sky and shadows enabled, no console errors', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=spa');
    const stats = await sceneStats(page);
    expect(stats.sky).toBe(true);
    expect(stats.shadows).toBe(true);
    expect(errors).toEqual([]);
  });
});

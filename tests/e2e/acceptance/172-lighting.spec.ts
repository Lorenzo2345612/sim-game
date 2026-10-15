import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type SceneStats172 = {
  directionalLights: number;
  maxWhiteAlbedo: number;
  shadows: boolean;
};

type RenderStats172 = {
  exposure: number;
  bloom: { strength: number; threshold: number } | null;
};

// Task 172 extends the hooks; the src/main.ts global declaration gains them only when implemented.
type Debug172 = { sceneStats(): SceneStats172; renderStats(): RenderStats172 };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function sceneStats(page: Page): Promise<SceneStats172> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug172).sceneStats());
}

function renderStats(page: Page): Promise<RenderStats172> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug172).renderStats());
}

test.describe('172 lighting calibration', () => {
  test('AT1: monza (v2) has exactly one directional light', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    expect((await sceneStats(page)).directionalLights).toBe(1);
    expect(errors).toEqual([]);
  });

  test('AT2: high preset at monza has exposure in [0.8, 0.9] and tame bloom', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&quality=high');
    const render = await renderStats(page);
    expect(render.exposure).toBeGreaterThanOrEqual(0.8);
    expect(render.exposure).toBeLessThanOrEqual(0.9);
    expect(render.bloom).not.toBeNull();
    if (render.bloom === null) throw new Error('bloom pass is off');
    expect(render.bloom.threshold).toBeGreaterThanOrEqual(1.0);
    expect(render.bloom.strength).toBeLessThanOrEqual(0.15);
    expect(errors).toEqual([]);
  });

  test('AT3: monza white paint albedo is above 0 and at most 0.7', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    const maxWhite = (await sceneStats(page)).maxWhiteAlbedo;
    expect(maxWhite).toBeGreaterThan(0);
    expect(maxWhite).toBeLessThanOrEqual(0.7);
    expect(errors).toEqual([]);
  });

  test('AT4: lusail has one directional light and the shadow setting stays on', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=lusail');
    const stats = await sceneStats(page);
    expect(stats.directionalLights).toBe(1);
    expect(stats.shadows).toBe(true);
    expect(errors).toEqual([]);
  });
});

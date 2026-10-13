import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

// Task 054 extends window.__SIMGAME__ with cameraMode()/gear()/preset(); the global
// declaration in src/main.ts only gains them when the task is implemented.
type Debug054 = {
  cameraMode(): 'chase' | 'tcam' | 'cockpit';
  gear(): number;
  preset(): 'low' | 'medium' | 'high';
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function cameraMode(page: Page): Promise<'chase' | 'tcam' | 'cockpit'> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug054).cameraMode());
}

test.describe('054 gameplay integration', () => {
  test('AT1: pressing C twice sets the camera mode to cockpit', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.keyboard.press('c');
    await page.keyboard.press('c');
    expect(await cameraMode(page)).toBe('cockpit');
  });

  test('AT2: holding ArrowUp 6 s reaches gear 3 or higher and the HUD shows it', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(6000);
    const state = await page.evaluate(() => ({
      gear: (window.__SIMGAME__ as unknown as Debug054).gear(),
      hudGear: document.querySelector('.hud2-gear')?.textContent ?? '',
    }));
    await page.keyboard.up('ArrowUp');
    expect(state.gear).toBeGreaterThanOrEqual(3);
    expect(state.hudGear).toBe(String(state.gear));
  });

  test('AT3: minimap canvas is visible at the top-right and has drawn pixels', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const minimap = page.locator('canvas:not(#game)');
    await expect(minimap).toBeVisible();
    const box = await minimap.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeLessThanOrEqual(32);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(viewport!.width - 32);
    const drawnPixels = await minimap.evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const r0 = data[0];
      const g0 = data[1];
      const b0 = data[2];
      const a0 = data[3];
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0 || data[i + 3] !== a0) n += 1;
      }
      return n;
    });
    expect(drawnPixels).toBeGreaterThan(0);
  });

  test('AT4: Escape shows the pause menu and simTime does not advance while paused', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const before = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
    expect(after - before).toBeCloseTo(0, 3);
  });

  test('AT5: no console errors during 10 s of driving', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza');
    errors.length = 0;
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(10000);
    await page.keyboard.up('ArrowUp');
    expect(errors).toEqual([]);
  });

  test('AT6: ?preset=low sets the preset to low and disables shadows', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza&preset=low');
    const state = await page.evaluate(() => ({
      preset: (window.__SIMGAME__ as unknown as Debug054).preset(),
      shadows: window.__SIMGAME__!.sceneStats().shadows,
    }));
    expect(state.preset).toBe('low');
    expect(state.shadows).toBe(false);
  });
});

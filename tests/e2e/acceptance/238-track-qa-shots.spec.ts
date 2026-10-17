import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

async function renderTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function monzaTerrainBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const json = JSON.parse(
    readFileSync(join(process.cwd(), 'public/tracks/monza.json'), 'utf8'),
  ) as { terrain: { originX: number; originZ: number; sizeX: number; sizeZ: number } };
  const t = json.terrain;
  return {
    minX: t.originX - t.sizeX / 2,
    maxX: t.originX + t.sizeX / 2,
    minZ: t.originZ - t.sizeZ / 2,
    maxZ: t.originZ + t.sizeZ / 2,
  };
}

test.describe('238 track QA shots', () => {
  test('AT4: qaCamera top is orthographic covering the monza terrain and hides the HUD', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?track=monza&quality=low');
    const info = await page.evaluate(() => window.__SIMGAME__!.qaCamera('top'));
    await renderTwoFrames(page);
    expect(info.kind).toBe('top');
    expect(info.orthographic).toBe(true);
    const b = monzaTerrainBounds();
    expect(info.left).toBeLessThanOrEqual(b.minX + 1);
    expect(info.right).toBeGreaterThanOrEqual(b.maxX - 1);
    expect(info.top).toBeLessThanOrEqual(b.minZ + 1);
    expect(info.bottom).toBeGreaterThanOrEqual(b.maxZ - 1);
    await expect(page.locator('#hud')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('AT5: qaCamera(null) restores the chase camera and the HUD', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza&quality=low');
    await page.evaluate(() => window.__SIMGAME__!.qaCamera('top'));
    await renderTwoFrames(page);
    const info = await page.evaluate(() => window.__SIMGAME__!.qaCamera(null));
    await renderTwoFrames(page);
    expect(info.kind).toBe('chase');
    expect(info.orthographic).toBe(false);
    await expect(page.locator('#hud')).toBeVisible();
  });
});

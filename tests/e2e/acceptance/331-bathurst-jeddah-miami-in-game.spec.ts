import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const PREVIOUS_COUNT = 25;
const NEW_IDS = ['bathurst', 'jeddah', 'miami'] as const;
const NEW_NAMES = ['Mount Panorama', 'Jeddah', 'Miami'] as const;
const ENV_BY_ID: Record<string, string> = { bathurst: 'parkland', jeddah: 'city', miami: 'city' };

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('331 bathurst, jeddah, miami in game', () => {
  test('AT1: the three buttons after ermita-veloz are bathurst, jeddah, miami and total = previous + 3', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    const buttons = page.locator('#menu button[data-track]');
    const ids = await buttons.evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).getAttribute('data-track') ?? ''),
    );
    expect(ids.length, 'total buttons').toBe(PREVIOUS_COUNT + 3);
    expect(ids[PREVIOUS_COUNT - 1], 'button before the new ones').toBe('ermita-veloz');
    expect(ids.slice(PREVIOUS_COUNT), 'new ids').toEqual([...NEW_IDS]);
    const names = await page.locator('#menu button[data-track] .track-name').allTextContents();
    expect(names.slice(PREVIOUS_COUNT), 'new names').toEqual([...NEW_NAMES]);
  });

  test('AT2: each new track loads with its id, no console errors, over 30 km/h after 3 s of throttle', async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    for (const id of NEW_IDS) {
      const mark = errors.length;
      await loadGame(page, `/?track=${id}`);
      expect(await page.evaluate(() => window.__SIMGAME__!.trackId()), `${id}: trackId`).toBe(id);
      await page.keyboard.down('ArrowUp');
      const start = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
      await page.waitForFunction(
        (from) => (window.__SIMGAME__?.getSimTime() ?? 0) - from >= 3,
        start,
        { timeout: 60000 },
      );
      await page.keyboard.up('ArrowUp');
      const speed = await page.evaluate(() => window.__SIMGAME__!.getSpeedKmh());
      expect(speed, `${id}: speed after 3 s`).toBeGreaterThan(30);
      expect(errors.slice(mark), `${id}: console errors`).toEqual([]);
    }
  });

  test('AT3: each new track reports its environment type and satellite ground texture', async ({ page }) => {
    test.setTimeout(300000);
    for (const id of NEW_IDS) {
      await loadGame(page, `/?track=${id}`);
      const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
      expect(stats.environmentType, `${id}: environment`).toBe(ENV_BY_ID[id]);
      expect(stats.groundTexture, `${id}: groundTexture`).toContain(`textures/ground/${id}.jpg`);
    }
  });
});

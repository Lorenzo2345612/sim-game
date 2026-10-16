import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const PREVIOUS_IDS = [
  'monza',
  'spa',
  'silverstone',
  'mexico',
  'daytona',
  'lusail',
  'bahrain',
  'braselton',
  'elkhart',
  'sepang',
  'baku',
  'budapest',
  'singapore',
  'lasvegas',
  'spielberg',
];

const NEW_IDS = ['fontana', 'cleveland', 'detroit'] as const;
const NEW_NAMES = ['Fontana', 'Cleveland', 'Detroit'] as const;

const ENV_BY_ID: Record<string, string> = {
  fontana: 'qwantani_noon_puresky',
  cleveland: 'kloofendal_48d_partly_cloudy_puresky',
  detroit: 'kloofendal_48d_partly_cloudy_puresky',
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('168 us tracks in game', () => {
  test('AT1: the three buttons immediately after spielberg are fontana, cleveland, detroit with their names and total = previous + 3', async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    const buttons = page.locator('#menu button[data-track]');
    const ids = await buttons.evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).getAttribute('data-track') ?? ''),
    );
    expect(ids.length, 'total buttons').toBe(PREVIOUS_IDS.length + 3);
    expect(ids[PREVIOUS_IDS.length - 1], 'button before the new ones').toBe('spielberg');
    expect(ids.slice(PREVIOUS_IDS.length), 'new ids after spielberg').toEqual([...NEW_IDS]);
    const names = await page.locator('#menu button[data-track] .track-name').allTextContents();
    expect(names.slice(PREVIOUS_IDS.length), 'new names after spielberg').toEqual([...NEW_NAMES]);
  });

  test('AT2: fontana, cleveland and detroit each load with their id, no console errors, over 30 km/h after 3 s of throttle', async ({
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

  test('AT3: each new track reports its expected HDRI environment and satellite ground texture', async ({
    page,
  }) => {
    test.setTimeout(300000);
    for (const id of NEW_IDS) {
      await loadGame(page, `/?track=${id}`);
      const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
      expect(stats.environment, `${id}: environment`).toBe(ENV_BY_ID[id]);
      expect(stats.groundTexture, `${id}: groundTexture`).toContain(`textures/ground/${id}.jpg`);
    }
  });
});

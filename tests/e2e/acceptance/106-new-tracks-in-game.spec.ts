import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

const MENU_IDS = [
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

const MENU_NAMES = [
  'Monza',
  'Spa',
  'Silverstone',
  'Mexico City',
  'Daytona',
  'Lusail',
  'Sakhir',
  'Braselton',
  'Elkhart Lake',
  'Sepang',
  'Baku',
  'Budapest',
  'Singapore',
  'Las Vegas',
  'Spielberg',
];

const NEW_IDS = MENU_IDS.slice(3);

const ENV_BY_ID: Record<string, string> = {
  mexico: 'kloofendal_48d_partly_cloudy_puresky',
  daytona: 'kloofendal_48d_partly_cloudy_puresky',
  lusail: 'qwantani_noon_puresky',
  bahrain: 'qwantani_noon_puresky',
  braselton: 'kloofendal_48d_partly_cloudy_puresky',
  elkhart: 'kloofendal_48d_partly_cloudy_puresky',
  sepang: 'kloofendal_48d_partly_cloudy_puresky',
  baku: 'kloofendal_48d_partly_cloudy_puresky',
  budapest: 'kloofendal_48d_partly_cloudy_puresky',
  singapore: 'kloofendal_48d_partly_cloudy_puresky',
  lasvegas: 'qwantani_noon_puresky',
  spielberg: 'kloofendal_48d_partly_cloudy_puresky',
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('106 new tracks in game', () => {
  test('AT1: the menu lists 15 track buttons in order with their names', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await expect(page.locator('#menu')).toBeVisible();
    const buttons = page.locator('#menu button[data-track]');
    const ids = await buttons.evaluateAll((els) =>
      els.map((el) => (el as HTMLButtonElement).getAttribute('data-track') ?? ''),
    );
    expect(ids).toEqual(MENU_IDS);
    const names = await page.locator('#menu button[data-track] .track-name').allTextContents();
    expect(names).toEqual(MENU_NAMES);
  });

  test('AT2: every new track loads with its id, no console errors, over 30 km/h after 3 s of throttle', async ({
    page,
  }) => {
    test.setTimeout(1200000);
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

  test('AT3: every new track uses its expected environment and satellite ground texture', async ({ page }) => {
    test.setTimeout(1200000);
    for (const id of NEW_IDS) {
      await loadGame(page, `/?track=${id}`);
      const stats = await page.evaluate(() => window.__SIMGAME__!.sceneStats());
      expect(stats.environment, `${id}: environment`).toBe(ENV_BY_ID[id]);
      expect(stats.groundTexture, `${id}: groundTexture`).toContain(`textures/ground/${id}.jpg`);
    }
  });
});

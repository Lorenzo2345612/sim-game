import { expect, test, type Page } from '@playwright/test';
import type { Standing } from '../../../src/race/classification';

test.use({ viewport: { width: 1280, height: 720 } });

type Debug094 = {
  raceStandings(): readonly Standing[];
  startLights(): number;
  getSimTime(): number;
  sceneStats(): { cars?: number; startLightsOn?: number };
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('094 race HUD and AI car rendering', () => {
  test("AT1: during 'lights' with 3 lights the gantry shows 3 red lights and startLightsOn = 3", async ({
    page,
  }) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await page.waitForFunction(
      () => (window.__SIMGAME__ as unknown as Debug094).startLights() === 3,
      undefined,
      { timeout: 120000 },
    );
    const lights = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug094).startLights(),
    );
    expect(lights).toBe(3);
    const startLightsOn = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug094).sceneStats().startLightsOn,
    );
    expect(startLightsOn).toBe(3);
    expect(errors).toEqual([]);
  });

  test('AT2: 10 s after go the tower has 6 rows, the player row is highlighted and #race-pos matches raceStandings', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await page.waitForFunction(
      () =>
        (window.__SIMGAME__ as unknown as Debug094).startLights() === 0 &&
        (window.__SIMGAME__ as unknown as Debug094).getSimTime() >= 20,
      undefined,
      { timeout: 120000 },
    );
    const rows = page.locator('#race-tower > *');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('#race-tower .player')).toHaveCount(1);
    const position = await page.evaluate(() => {
      const standings = (window.__SIMGAME__ as unknown as Debug094).raceStandings();
      const player = standings.find((s) => s.car === 0);
      return player?.position ?? -1;
    });
    expect(position).toBeGreaterThan(0);
    await expect(page.locator('#race-pos')).toHaveText(`P${position}/6`);
  });

  test('AT3: in a race with ai=5 sceneStats().cars is 6', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?race=1&track=monza&ai=5');
    await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
      timeout: 60000,
    });
    const cars = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug094).sceneStats().cars,
    );
    expect(cars).toBe(6);
  });
});

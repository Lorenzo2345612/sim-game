import { expect, test, type Page } from '@playwright/test';
import type { Standing } from '../../src/race/classification';

test.use({ viewport: { width: 1280, height: 720 } });

type RaceHooks = {
  raceStandings(): readonly Standing[];
  carCount(): number;
  startLights(): number;
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

const hooks = (page: Page): Promise<{ cars: number; lights: number; standings: Standing[] }> =>
  page.evaluate(() => {
    const h = window.__SIMGAME__ as unknown as RaceHooks;
    return {
      cars: h.carCount(),
      lights: h.startLights(),
      standings: h.raceStandings().map((s) => ({ ...s })),
    };
  });

test.describe('093 race hooks', () => {
  test('carCount follows the ai query and standings cover every car', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?race=1&track=monza&ai=2');
    const state = await hooks(page);
    expect(state.cars).toBe(3);
    expect(state.lights).toBeGreaterThanOrEqual(0);
    expect(state.lights).toBeLessThanOrEqual(5);
    expect(state.standings).toHaveLength(3);
    expect(state.standings.map((s) => s.car).sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(state.standings.map((s) => s.position).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  test('single-car mode reports the race hook defaults', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    const state = await hooks(page);
    expect(state.cars).toBe(1);
    expect(state.lights).toBe(0);
    expect(state.standings).toEqual([]);
  });
});

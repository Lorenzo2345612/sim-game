import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

interface RaceHooks {
  ready: boolean;
  carCount(): number;
  startLights(): number;
  raceStandings(): { car: number }[];
  surfaceUnderCar(): string;
  trackHeightUnderCar(): number;
  gear(): number;
  rpm(): number;
  getHeading(): number;
  telemetry(): { fuelKg: number; rpm: number; gear: number };
}

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

const hooks = (page: Page) =>
  page.evaluate(() => {
    const h = window.__SIMGAME__ as unknown as RaceHooks;
    return {
      cars: h.carCount(),
      standings: h.raceStandings().length,
      surface: h.surfaceUnderCar(),
      heightIsNaN: Number.isNaN(h.trackHeightUnderCar()),
      gear: h.gear(),
      rpm: h.rpm(),
      heading: h.getHeading(),
      fuel: h.telemetry().fuelKg,
    };
  });

test.describe('093 race game post-code gaps', () => {
  test('the race player-sim adapter serves car 0 and inert height', async ({ page }) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await loadGame(page, '/?race=1&track=monza&ai=1');
    const state = await hooks(page);
    expect(state.cars).toBe(2);
    expect(state.standings).toBe(2);
    expect(state.surface, 'surfaceUnderCar falls back to asphalt in a race').toBe('asphalt');
    expect(state.heightIsNaN, 'trackHeightUnderCar is inert in a race').toBe(true);
    expect(Number.isFinite(state.gear), 'gear comes from car 0').toBe(true);
    expect(state.rpm, 'rpm comes from car 0').toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(state.heading), 'heading comes from car 0').toBe(true);
    expect(state.fuel, 'telemetry comes from car 0').toBeGreaterThan(0);
    expect(errors, 'no console errors').toEqual([]);
  });

  test('only race=1 starts a race', async ({ page }) => {
    test.setTimeout(180000);
    for (const path of ['/?race=0&track=monza&ai=3', '/?race=true&track=monza&ai=3', '/?race=&track=monza&ai=3']) {
      await loadGame(page, path);
      const state = await hooks(page);
      expect(state.cars, path).toBe(1);
      expect(state.standings, path).toBe(0);
    }
  });

  test('fractional and negative fractional ai values are floored then clamped', async ({ page }) => {
    test.setTimeout(180000);
    await loadGame(page, '/?race=1&track=monza&ai=2.9');
    expect((await hooks(page)).cars, 'ai=2.9 floors to 2').toBe(3);
    await loadGame(page, '/?race=1&track=monza&ai=-0.5');
    expect((await hooks(page)).cars, 'ai=-0.5 floors to -1 and clamps to 0').toBe(1);
  });
});

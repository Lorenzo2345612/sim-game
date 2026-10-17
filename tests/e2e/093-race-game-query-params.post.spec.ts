import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

type RaceHooks = {
  carCount(): number;
  trackId(): string;
  carId(): string;
};

interface RaceQueryState {
  cars: number;
  track: string;
  car: string;
}

async function loadRace(page: Page, path: string): Promise<RaceQueryState> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
  return page.evaluate(() => {
    const h = window.__SIMGAME__ as unknown as RaceHooks;
    return { cars: h.carCount(), track: h.trackId(), car: h.carId() };
  });
}

test.describe('093 race track and car query parameters', () => {
  test('track and car are resolved as in startGame', async ({ page }) => {
    test.setTimeout(120000);
    const state = await loadRace(page, '/?race=1&track=spa&car=gt3-a&ai=2');
    expect(state.track, 'track').toBe('spa');
    expect(state.car, 'car').toBe('gt3-a');
    expect(state.cars, 'ai=2 means 3 cars').toBe(3);
  });

  test('empty and unknown track/car values fall back to the defaults', async ({ page }) => {
    test.setTimeout(120000);
    const state = await loadRace(page, '/?race=1&track=&car=not-a-car&ai=0');
    expect(state.track, 'empty track').toBe('monza');
    expect(state.car, 'unknown car').toBe('f4');
    expect(state.cars, 'ai=0 means 1 car').toBe(1);
  });
});

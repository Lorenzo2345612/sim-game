import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 720 } });

interface RaceHooks {
  ready: boolean;
  carCount(): number;
  startLights(): number;
  getSimTime(): number;
  getLap(): number;
  carPosition(): { x: number; y: number; z: number };
  teleportToIndex(i: number): void;
  raceStandings(): { car: number; position: number; distance: number }[];
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
      lap: h.getLap(),
      pos: h.carPosition(),
    };
  });

// go is at most 2 (grid) + 4 (lights) + 0.2 + 2.8 (hold) = 9 s; after it the lights are 0 again.
async function waitForGo(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const h = window.__SIMGAME__ as unknown as RaceHooks | undefined;
      return h !== undefined && h.startLights() === 0 && h.getSimTime() >= 9.5;
    },
    undefined,
    { timeout: 60000, polling: 100 },
  );
}

test.describe('093 race game post-code gaps (adapter and query fallbacks)', () => {
  test('teleportToIndex is inert in a race and the lap counter stays empty', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?race=1&track=monza&ai=1');
    const before = await hooks(page);
    await page.evaluate(() => {
      const h = window.__SIMGAME__ as unknown as RaceHooks;
      h.teleportToIndex(50);
      h.teleportToIndex(99999);
      h.teleportToIndex(-1);
    });
    const after = await hooks(page);
    const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z);
    expect(moved, 'the player is not teleported in a race').toBeLessThan(0.5);
    expect(after.lap, 'lap info is inert in a race').toBe(0);
    expect(after.cars).toBe(2);
  });

  test('every difficulty value and unknown ones start a race with the right field', async ({
    page,
  }) => {
    test.setTimeout(300000);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    for (const path of [
      '/?race=1&track=monza&ai=1&diff=expert&laps=1&seed=99',
      '/?race=1&track=monza&ai=2&diff=bogus&laps=0&seed=not-a-number',
      '/?race=1&track=monza&ai=0&diff=&laps=abc&seed=',
    ]) {
      await loadGame(page, path);
      await waitForGo(page);
      const state = await page.evaluate(() => {
        const h = window.__SIMGAME__ as unknown as RaceHooks;
        return {
          cars: h.carCount(),
          rows: h.raceStandings().map((s) => ({ car: s.car, position: s.position, distance: s.distance })),
          lights: h.startLights(),
          t: h.getSimTime(),
        };
      });
      expect(state.rows.length, path).toBe(state.cars);
      expect(
        state.rows.map((s) => s.position).sort((a, b) => a - b),
        path,
      ).toEqual(state.rows.map((_, i) => i + 1));
      expect(state.rows.map((s) => s.car).sort((a, b) => a - b), path).toEqual(
        state.rows.map((_, i) => i),
      );
      expect(state.rows.every((s) => Number.isFinite(s.distance)), path).toBe(true);
      expect(state.lights, path).toBe(0);
      expect(state.t, path).toBeGreaterThanOrEqual(8);
    }
    expect(errors, 'no console errors').toEqual([]);
  });
});

import { expect, test, type Page } from '@playwright/test';
import type { Standing } from '../../../src/race/classification';

test.use({ viewport: { width: 1280, height: 720 } });

type Debug093 = {
  raceStandings(): readonly Standing[];
  startLights(): number;
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

test.describe('093 race game', () => {
  test('AT5: ?race=1&track=monza&ai=5 — 20 s after go standings have 6 entries with positions 1..6 and no console errors', async ({
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
      () =>
        (window.__SIMGAME__ as unknown as Debug093)?.startLights() === 0 &&
        (window.__SIMGAME__?.getSimTime() ?? 0) >= 28,
      undefined,
      { timeout: 120000 },
    );
    const standings = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug093).raceStandings(),
    );
    expect(standings).toHaveLength(6);
    expect(standings.map((s) => s.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(errors).toEqual([]);
  });
});

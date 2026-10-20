import { expect, test, type Page } from '@playwright/test';
import type { SectorFlag } from '../../../src/race/flags';

const RACE = '/?race=1&track=cleveland&ai=5&laps=3';

type Debug310 = {
  debugFlagOverride(
    o: { flags: SectorFlag[]; playerSector: number; countdowns?: number[] } | null,
  ): void;
};

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

async function simAdvance(page: Page, seconds: number): Promise<void> {
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction((t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t, t0 + seconds, {
    timeout: 60000,
  });
}

async function raceAfterLights(page: Page, after: number): Promise<void> {
  await page.waitForFunction(() => (window.__SIMGAME__?.startLights() ?? -1) > 0, undefined, {
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SIMGAME__?.startLights() === 0, undefined, {
    timeout: 60000,
  });
  await simAdvance(page, after);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function override(
  page: Page,
  flags: SectorFlag[],
  playerSector: number,
  countdowns?: number[],
): Promise<void> {
  await page.evaluate(
    (o) => (window.__SIMGAME__ as unknown as Debug310).debugFlagOverride(o),
    { flags, playerSector, countdowns },
  );
}

test.describe('310 yellow countdown HUD', () => {
  test('AT6: countdown shows alert digit, slow lights and dashed yellow on the minimap', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await override(page, ['green', 'green', 'green'], 2, [NaN, 2.5, NaN]);
    await page.waitForTimeout(500);

    await expect(page.locator('#yellow-countdown')).toBeVisible();
    await expect(page.locator('#yellow-countdown .cd-digit')).toHaveText('3');
    expect(
      await page.evaluate(() => document.getElementById('yellow-alert')?.dataset.lights),
    ).toBe('slow');

    const yellowPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.minimap') as HTMLCanvasElement | null;
      if (canvas === null) return -1;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return -1;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - 255) <= 12 &&
          Math.abs(data[i + 1] - 212) <= 12 &&
          Math.abs(data[i + 2]) <= 12
        ) {
          n++;
        }
      }
      return n;
    });
    expect(yellowPixels).toBeGreaterThanOrEqual(60);
    expect(errors).toEqual([]);
  });

  test('AT7: a yellow flag replaces the countdown', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await override(page, ['green', 'green', 'green'], 2, [NaN, 2.5, NaN]);
    await page.waitForTimeout(500);
    await override(page, ['green', 'yellow', 'green'], 2);
    await page.waitForTimeout(500);

    await expect(page.locator('#yellow-countdown')).toBeHidden();
    expect(
      await page.evaluate(() => document.getElementById('yellow-alert')?.dataset.mode),
    ).toBe('yellow');
    expect(errors).toEqual([]);
  });
});

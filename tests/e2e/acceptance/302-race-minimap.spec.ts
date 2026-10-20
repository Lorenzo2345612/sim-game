import { expect, test, type Page } from '@playwright/test';
import type { SectorFlag } from '../../../src/race/flags';

const RACE = '/?race=1&track=cleveland&ai=5&laps=3';
const PRACTICE = '/?track=cleveland';

type Debug302 = {
  minimapStats(): { size: number; ai: number; player: number; stopped: number };
  debugFlagOverride(o: { flags: SectorFlag[]; playerSector: number } | null): void;
};

test.use({ viewport: { width: 1280, height: 720 } });
test.describe.configure({ timeout: 180_000 });

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 90000 });
}

// Lights out, then `after` s of simulation time after the race starts.
async function raceAfterLights(page: Page, after: number): Promise<void> {
  await page.waitForFunction(
    () => (window.__SIMGAME__?.startLights() ?? -1) > 0,
    undefined,
    { timeout: 60000 },
  );
  await page.waitForFunction(() => window.__SIMGAME__?.startLights() === 0, undefined, {
    timeout: 60000,
  });
  const t0 = await page.evaluate(() => window.__SIMGAME__!.getSimTime());
  await page.waitForFunction((t) => (window.__SIMGAME__?.getSimTime() ?? 0) >= t, t0 + after, {
    timeout: 60000,
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Minimap pixels within `tol` per channel of any target colour. */
async function countNearPixels(
  page: Page,
  targets: readonly (readonly [number, number, number])[],
  tol: number,
): Promise<number> {
  return page.evaluate(
    ({ t, d }) => {
      const canvas = document.querySelector('canvas.minimap') as HTMLCanvasElement | null;
      if (canvas === null) return -1;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return -1;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        for (const [tr, tg, tb] of t) {
          if (
            Math.abs(data[i] - tr) <= d &&
            Math.abs(data[i + 1] - tg) <= d &&
            Math.abs(data[i + 2] - tb) <= d
          ) {
            n++;
            break;
          }
        }
      }
      return n;
    },
    { t: targets as [number, number, number][], d: tol },
  );
}

async function overrideFlags(
  page: Page,
  flags: SectorFlag[],
  playerSector: number,
): Promise<void> {
  await page.evaluate(
    (o) => (window.__SIMGAME__ as unknown as Debug302).debugFlagOverride(o),
    { flags, playerSector },
  );
}

test.describe('302 race minimap', () => {
  test('AT5: race minimap is a 260 px square with a legend and stats 2 s after lights out', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    const box = await page.evaluate(() => {
      const m = document.querySelector('canvas.minimap');
      const legend = document.querySelector('.minimap-legend');
      const mr = m?.getBoundingClientRect() ?? null;
      const lr = legend?.getBoundingClientRect() ?? null;
      const cs = legend === null ? null : getComputedStyle(legend);
      return {
        w: mr?.width ?? -1,
        h: mr?.height ?? -1,
        top: mr?.top ?? -1,
        right: mr?.right ?? -1,
        legendTop: lr?.top ?? -1,
        legendVisible:
          legend !== null && lr !== null && lr.height > 0 && cs !== null && cs.display !== 'none',
        legendText: legend?.textContent ?? '',
        viewportW: window.innerWidth,
      };
    });
    expect(Math.abs(box.w - 260)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.h - 260)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.viewportW - box.right - 12)).toBeLessThanOrEqual(1);
    expect(box.legendVisible).toBe(true);
    expect(box.legendText).toContain('you');
    expect(box.legendText).toContain('AI');
    expect(box.legendText).toContain('stopped');
    expect(box.legendTop).toBeGreaterThanOrEqual(box.top + box.h);
    const stats = await page.evaluate(
      () => (window.__SIMGAME__ as unknown as Debug302).minimapStats(),
    );
    expect(stats.size).toBe(260);
    expect(stats.ai).toBe(5);
    expect(stats.player).toBe(1);
    expect(errors).toEqual([]);
  });

  test('AT6: the yellow sector override draws at least 150 blinking-yellow pixels', async ({
    page,
  }) => {
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await overrideFlags(page, ['green', 'yellow', 'green'], 2);
    await page.waitForTimeout(1000);
    const yellow = await countNearPixels(
      page,
      [
        [255, 212, 0],
        [160, 134, 0],
      ],
      12,
    );
    expect(yellow).toBeGreaterThanOrEqual(150);
  });

  test('AT7: an all-green override clears the yellow pixels and the player stays blue', async ({
    page,
  }) => {
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await overrideFlags(page, ['green', 'green', 'green'], 2);
    await page.waitForTimeout(500);
    const yellow = await countNearPixels(
      page,
      [
        [255, 212, 0],
        [160, 134, 0],
      ],
      12,
    );
    expect(yellow).toBeLessThanOrEqual(5);
    const blue = await countNearPixels(page, [[47, 125, 255]], 12);
    expect(blue).toBeGreaterThanOrEqual(150);
  });

  test('AT8: without a race the minimap stays 160 px and no legend exists', async ({ page }) => {
    await loadGame(page, PRACTICE);
    const box = await page.evaluate(() => {
      const m = document.querySelector('canvas.minimap') as HTMLCanvasElement | null;
      const r = m?.getBoundingClientRect() ?? null;
      return {
        w: r?.width ?? -1,
        h: r?.height ?? -1,
        legend: document.querySelector('.minimap-legend') !== null,
      };
    });
    expect(Math.abs(box.w - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.h - 160)).toBeLessThanOrEqual(1);
    expect(box.legend).toBe(false);
  });
});

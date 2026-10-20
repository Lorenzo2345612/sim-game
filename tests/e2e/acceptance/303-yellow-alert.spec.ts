import { expect, test, type Page } from '@playwright/test';
import type { SectorFlag } from '../../../src/race/flags';

const RACE = '/?race=1&track=cleveland&ai=5&laps=3';

type Debug303 = {
  debugFlagOverride(o: { flags: SectorFlag[]; playerSector: number } | null): void;
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
  await page.waitForFunction(
    () => (window.__SIMGAME__?.startLights() ?? -1) > 0,
    undefined,
    { timeout: 60000 },
  );
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

async function overrideFlags(
  page: Page,
  flags: SectorFlag[],
  playerSector: number,
): Promise<void> {
  await page.evaluate(
    (o) => (window.__SIMGAME__ as unknown as Debug303).debugFlagOverride(o),
    { flags, playerSector },
  );
}

async function alertMode(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () => (document.getElementById('yellow-alert') as HTMLElement | null)?.dataset.mode,
  );
}

test.describe('303 yellow alert', () => {
  test('AT9: yellow sector shows flashing lights and banner without overlaps', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await overrideFlags(page, ['green', 'yellow', 'green'], 2);
    await page.waitForTimeout(500);

    expect(await alertMode(page)).toBe('yellow');
    const banner = page.locator('#yellow-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText('⚠ YELLOW FLAG · SECTOR 2 · NO OVERTAKING');
    await expect(page.locator('#yellow-alert .led')).toHaveCount(2);
    const counts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#yellow-alert .led')).map(
        (l) => l.querySelectorAll('.light').length,
      ),
    );
    expect(counts).toEqual([4, 4]);

    const samples = await page.evaluate(async () => {
      const out: string[] = [];
      const el = document.getElementById('yellow-alert') as HTMLElement;
      for (let i = 0; i < 15; i++) {
        out.push(el.dataset.lights ?? '');
        await new Promise((r) => setTimeout(r, 100));
      }
      return out;
    });
    expect(samples.filter((s) => s === 'on').length).toBeGreaterThanOrEqual(2);
    expect(samples.filter((s) => s === 'off').length).toBeGreaterThanOrEqual(2);

    const overlaps = await page.evaluate(() => {
      const b = document.getElementById('yellow-banner')!.getBoundingClientRect();
      const hit: string[] = [];
      for (const sel of ['.minimap', '.minimap-legend', '#race-tower', '.race-hud-top']) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) {
            hit.push(sel);
          }
        }
      }
      return hit;
    });
    expect(overlaps).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('AT10: clearing the flag shows sector clear then hides', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    await overrideFlags(page, ['green', 'yellow', 'green'], 2);
    await page.waitForTimeout(500);
    await overrideFlags(page, ['green', 'green', 'green'], 2);
    await page.waitForFunction(
      () => document.getElementById('yellow-alert')?.dataset.mode === 'clear',
      undefined,
      { timeout: 500 },
    );
    await expect(page.locator('#yellow-banner')).toHaveText('✓ SECTOR CLEAR · GREEN');

    await simAdvance(page, 3.5);
    expect(await alertMode(page)).toBe('none');
    await expect(page.locator('#yellow-banner')).not.toBeVisible();
    expect(errors).toEqual([]);
  });

  test('AT11: legacy #flags stays in the DOM, hidden, and keeps updating', async ({ page }) => {
    const errors = watchErrors(page);
    await loadGame(page, RACE);
    await raceAfterLights(page, 2);
    const flags = page.locator('#flags');
    await expect(flags).toHaveCount(1);
    await expect(flags).not.toBeVisible();
    for (const id of ['flag-s1', 'flag-s2', 'flag-s3']) {
      const state = await page.evaluate(
        (i) => document.getElementById(i)?.dataset.state,
        id,
      );
      expect(state).toBeTruthy();
    }
    expect(errors).toEqual([]);
  });
});

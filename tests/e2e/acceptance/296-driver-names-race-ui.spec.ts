import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { generateGrid, seriesForTrack } from '../../../src/race/drivers';
import type { GridsFile, NameList } from '../../../src/race/drivers';

test.use({ viewport: { width: 1366, height: 768 } });
test.describe.configure({ timeout: 180_000 });

const ROOT = join(__dirname, '..', '..', '..');
const NAMES_DIR = join(ROOT, 'public', 'career', 'names');

const raceUrl = (track: string): string => `/?race=1&track=${track}&ai=5&laps=3&seed=1`;

type Driver296 = { car: number; first: string; last: string; code: string; nat: string };

type Debug296 = {
  raceDrivers(): Driver296[];
  forceTrackLimits(count: number, car?: number): void;
  finishRaceNow?(): void;
};

type TowerRow296 = { pos: string; name: string; player: boolean };

async function loadRace(page: Page, track: string): Promise<void> {
  await page.goto(raceUrl(track));
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, {
    timeout: 90000,
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

async function raceDrivers(page: Page): Promise<Driver296[]> {
  return page.evaluate(() => (window.__SIMGAME__ as unknown as Debug296).raceDrivers());
}

async function towerRows(page: Page): Promise<TowerRow296[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#race-tower .race-row')].map((el) => ({
      pos: el.querySelector('.race-row-pos')?.textContent ?? '',
      name: el.querySelector('.race-row-name')?.textContent ?? '',
      player: el.classList.contains('player'),
    })),
  );
}

function loadGrids(): GridsFile {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'career', 'grids.json'), 'utf8')) as GridsFile;
}

function loadNames(): Record<string, NameList> {
  const out: Record<string, NameList> = {};
  for (const f of readdirSync(NAMES_DIR)) {
    if (!f.endsWith('.json') || f === 'blocklist.json') continue;
    out[f.replace(/\.json$/, '')] = JSON.parse(
      readFileSync(join(NAMES_DIR, f), 'utf8'),
    ) as NameList;
  }
  return out;
}

function driverKeys(ds: readonly Omit<Driver296, 'car'>[]): string[] {
  return ds.map((d) => `${d.first} ${d.last} ${d.code} ${d.nat}`);
}

test.describe('296 driver names in the race UI', () => {
  test('AT2: mexico seed 1 shows generated names in raceDrivers() and every tower row', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadRace(page, 'mexico');
    await page.waitForTimeout(3000);
    const list = await raceDrivers(page);
    expect(list).toHaveLength(5);
    expect(list.some((d) => d.nat === 'MEX')).toBe(true);
    const rows = await towerRows(page);
    expect(rows).toHaveLength(6);
    const playerRows = rows.filter((r) => r.player);
    expect(playerRows).toHaveLength(1);
    expect(playerRows[0].name).toBe('You');
    const standings = await page.evaluate(() => window.__SIMGAME__!.raceStandings());
    const carByPos = new Map(standings.map((s) => [s.position, s.car]));
    const codeByCar = new Map(list.map((d) => [d.car, d.code]));
    const aiRows = rows.filter((r) => !r.player);
    expect(aiRows).toHaveLength(5);
    for (const r of aiRows) {
      const car = carByPos.get(Number(r.pos));
      expect(car).toBeDefined();
      expect(car).not.toBe(0);
      expect(r.name).toBe(codeByCar.get(car!));
      expect(r.name).not.toMatch(/^AI \d+$/);
    }
    expect(errors).toEqual([]);
  });

  test('AT3: monza seed 1 draws every nat from the f4-europe mix and differs from the mexico grid', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadRace(page, 'monza');
    await page.waitForTimeout(3000);
    const list = await raceDrivers(page);
    expect(list).toHaveLength(5);
    const grids = loadGrids();
    const seriesId = seriesForTrack(grids, 'monza');
    expect(seriesId).toBe('f4-europe');
    const nats = Object.keys(grids.series[seriesId].mix);
    for (const d of list) expect(nats).toContain(d.nat);
    const mexico = generateGrid(
      5,
      1,
      grids.series[seriesForTrack(grids, 'mexico')].mix,
      loadNames(),
    );
    expect(driverKeys(list)).not.toEqual(driverKeys(mexico));
    expect(errors).toEqual([]);
  });

  test('AT4: results after finishRaceNow show full AI names and no AI n cell', async ({ page }) => {
    const errors = watchErrors(page);
    await loadRace(page, 'mexico');
    await page.waitForTimeout(3000);
    const list = await raceDrivers(page);
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug296).finishRaceNow?.());
    await expect(page.locator('#results')).toBeVisible();
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('#results .results-table tbody tr')].map(
        (tr) => tr.children[1]?.textContent ?? '',
      ),
    );
    expect(names).toHaveLength(6);
    expect(names).toContain('You');
    for (const d of list) expect(names).toContain(`${d.first} ${d.last}`);
    for (const n of names) expect(n).not.toMatch(/AI \d+/);
    expect(errors).toEqual([]);
  });

  test('AT5: forceTrackLimits(4, 2) shows the car 2 short name in race control within 1 s', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await loadRace(page, 'mexico');
    await page.waitForTimeout(3000);
    const list = await raceDrivers(page);
    const d2 = list.find((d) => d.car === 2);
    expect(d2).toBeDefined();
    const short = `${d2!.first.charAt(0)}. ${d2!.last}`.toUpperCase();
    await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug296).forceTrackLimits!(4, 2));
    await page.waitForFunction(
      (expected) => {
        const rc = document.querySelector('#race-control');
        if (rc === null) return false;
        const cs = getComputedStyle(rc);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const r = rc.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const text = rc.textContent ?? '';
        return text.includes('TRACK LIMITS') && text.includes(`FOR ${expected}`);
      },
      short,
      { timeout: 1000 },
    );
    await expect(page.locator('#race-control')).toContainText('TRACK LIMITS');
    await expect(page.locator('#race-control')).toContainText(`FOR ${short}`);
    expect(errors).toEqual([]);
  });

  test('AT6: with grids.json blocked the race runs and the tower falls back to AI n', async ({
    page,
  }) => {
    await page.route('**/career/grids.json', (route) => route.abort());
    await loadRace(page, 'mexico');
    await page.waitForTimeout(3000);
    const rows = await towerRows(page);
    expect(rows).toHaveLength(6);
    const playerRows = rows.filter((r) => r.player);
    expect(playerRows).toHaveLength(1);
    expect(playerRows[0].name).toBe('You');
    const aiRows = rows.filter((r) => !r.player);
    expect(aiRows).toHaveLength(5);
    for (const r of aiRows) expect(r.name).toMatch(/^AI \d+$/);
  });
});

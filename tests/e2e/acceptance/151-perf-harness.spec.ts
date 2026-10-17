import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';

// Task 151 adds perfStats(); until src/main.ts is updated the debug handle is
// accessed through a local mirror type (the 150 pattern).
type Percentiles = { p50: number; p95: number };
type PerfStats = {
  fps: number;
  frameMs: Percentiles;
  simMs: Percentiles;
  renderMs: Percentiles;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
};
type Debug151 = {
  perfStats(): PerfStats;
  sceneStats(): { timeOfDay?: string; rainParticles?: unknown };
};

const SCENARIOS = ['monza-chase', 'spa-race16', 'monza-cockpit', 'lusail-night', 'spa-rain'];
const GUARDED_PATHS: Record<string, string> = {
  'lusail-night': '/?track=lusail',
  'spa-rain': '/?track=spa&rain=1',
};

async function loadGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => window.__SIMGAME__?.ready === true, undefined, { timeout: 60000 });
}

function allFinite(stats: PerfStats): boolean {
  return [
    stats.fps,
    stats.frameMs.p50,
    stats.frameMs.p95,
    stats.simMs.p50,
    stats.simMs.p95,
    stats.renderMs.p50,
    stats.renderMs.p95,
    stats.drawCalls,
    stats.triangles,
    stats.textures,
    stats.geometries,
  ].every((v) => Number.isFinite(v));
}

async function runBench(url: string, out: string): Promise<number> {
  const bench = join(process.cwd(), 'scripts/perf/bench.mjs');
  try {
    await promisify(execFile)('node', [bench, url, out], { timeout: 360000 });
    return 0;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === 'number' ? code : 1;
  }
}

test.describe('151 performance harness acceptance', () => {
  test('AT2: after 3 s on /?track=monza perfStats() has all fields finite and drawCalls > 0', async ({ page }) => {
    test.setTimeout(120000);
    await loadGame(page, '/?track=monza');
    await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug151).perfStats());
    expect(allFinite(stats)).toBe(true);
    expect(stats.drawCalls).toBeGreaterThan(0);
  });

  test('AT3: bench.mjs <url> out.json exits 0 with a perfStats object per scenario key', async ({ page }) => {
    test.setTimeout(420000);
    const url = `http://localhost:${process.env.E2E_PORT ?? 4173}`;
    const out = join(await mkdtemp(join(tmpdir(), 'perf151-')), 'out.json');
    const code = await runBench(url, out);
    expect(code).toBe(0);
    const results = JSON.parse(await readFile(out, 'utf8')) as Record<string, PerfStats>;
    for (const key of Object.keys(results)) expect(SCENARIOS).toContain(key);
    for (const key of ['monza-chase', 'spa-race16', 'monza-cockpit']) {
      expect(Object.keys(results)).toContain(key);
    }
    for (const [key, path] of Object.entries(GUARDED_PATHS)) {
      await loadGame(page, path);
      const scene = await page.evaluate(() => (window.__SIMGAME__ as unknown as Debug151).sceneStats());
      const expected =
        key === 'lusail-night' ? scene.timeOfDay === 'night' : scene.rainParticles !== undefined;
      expect(Object.keys(results).includes(key)).toBe(expected);
    }
    for (const stats of Object.values(results)) expect(allFinite(stats)).toBe(true);
  });
});

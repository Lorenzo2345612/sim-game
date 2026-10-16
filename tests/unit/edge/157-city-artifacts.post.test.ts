import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakeCity } from '../../../tools/env/bakeCity';
import type { CityEnv } from '../../../tools/env/osmBuildings';

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['baku', 'singapore', 'lasvegas'] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('157 city bake artifacts', () => {
  it('the three raw Overpass extracts exist and hold elements', () => {
    for (const id of IDS) {
      const path = join(ROOT, 'assets', 'source', 'osm', `${id}-city.json`);
      expect(existsSync(path), path).toBe(true);
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { elements: unknown[] };
      expect(Array.isArray(parsed.elements), `${id} elements`).toBe(true);
      expect(parsed.elements.length, `${id} elements`).toBeGreaterThan(0);
    }
  });

  it('ASSETS_LICENSES.md has an ODbL row covering the city extracts', () => {
    const licenses = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    const row = licenses.split('\n').find((l) => l.includes('-city.json'));
    expect(row, 'row mentioning -city.json').toBeDefined();
    expect(row).toContain('ODbL');
  });

  it('env files are compact JSON without extra whitespace', () => {
    for (const id of IDS) {
      const raw = readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), 'utf8');
      expect(/\n|\r/.test(raw), `${id} newlines`).toBe(false);
      expect(raw.includes(': '), `${id} spaced separators`).toBe(false);
      expect(raw.trim(), `${id} padding`).toBe(raw);
    }
  });

  it('bakeCity reuses the cached extract offline and rewrites baku-env.json byte-identically', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      calls.push(args);
      throw new Error('network disabled in tests');
    });
    const envPath = join(ROOT, 'public', 'tracks', 'baku-env.json');
    const before = readFileSync(envPath);
    const result = await bakeCity('baku');
    expect(calls, 'fetch must not be called when the cache exists').toHaveLength(0);
    const after = readFileSync(envPath);
    expect(after.equals(before), 'bake from cache changed baku-env.json').toBe(true);
    const env = JSON.parse(after.toString('utf8')) as CityEnv;
    expect(result).toEqual({
      buildings: env.buildings.length,
      walls: env.walls.length,
      water: env.water.length,
    });
  }, 120000);

  it('build:env bakes every id given and rewrites each env file byte-identically', () => {
    const paths = IDS.map((id) => join(ROOT, 'public', 'tracks', `${id}-env.json`));
    const before = paths.map((p) => readFileSync(p));
    execFileSync('npm', ['run', 'build:env', '--', 'baku', 'singapore'], {
      cwd: ROOT,
      timeout: 240000,
    });
    paths.forEach((p, i) => {
      expect(readFileSync(p).equals(before[i]), `${IDS[i]} env changed by multi-id bake`).toBe(true);
    });
  }, 300000);

  it('bakeCity rejects an unknown track id without fetching', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', (...args: unknown[]) => {
      calls.push(args);
      throw new Error('network disabled in tests');
    });
    await expect(bakeCity('no-such-track')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

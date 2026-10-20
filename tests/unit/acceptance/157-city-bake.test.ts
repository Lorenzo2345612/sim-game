import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Task 157 lands tools/env/osmBuildings.ts; the variable specifier keeps typecheck
// green until the module exists (the 162 pattern).
const OSM_BUILDINGS_MODULE = '../../../tools/env/osmBuildings';
type HeightOf = (tags: Record<string, string>) => number;

type P = [number, number];

// Local copy of the CityEnv contract in tools/env/osmBuildings.ts (same reason as above).
interface Building {
  ring: P[];
  height: number;
  material: string;
}
interface Wall {
  line: P[];
  height: number;
  thickness: number;
}
interface CityEnv {
  buildings: Building[];
  walls: Wall[];
  water: P[][];
}

const MATERIALS = ['glass', 'concrete', 'brick', 'stone'] as const;
const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['baku', 'singapore', 'lasvegas'] as const;

function loadEnv(id: string): CityEnv {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), 'utf8'),
  ) as CityEnv;
}

async function loadHeightOf(): Promise<HeightOf> {
  const mod = (await import(OSM_BUILDINGS_MODULE)) as { heightOf: HeightOf };
  return mod.heightOf;
}

function collectStrings(node: unknown, keys: string[], strings: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, keys, strings);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      keys.push(k);
      collectStrings(v, keys, strings);
    }
    return;
  }
  if (typeof node === 'string') strings.push(node);
}

function bake(id: string): void {
  execFileSync('npm', ['run', 'build:env', '--', id], { cwd: ROOT, timeout: 240000 });
}

describe('157 city bake acceptance', () => {
  it('AT1: heightOf resolves height tags, level counts and type defaults (45 / 32 / 7 / 12)', async () => {
    const heightOf = await loadHeightOf();
    expect(heightOf({ height: '45 m' }), "height: '45 m'").toBeCloseTo(45, 5);
    expect(heightOf({ 'building:levels': '10' }), "'building:levels': '10'").toBeCloseTo(32, 5);
    expect(heightOf({ building: 'house' }), "building: 'house'").toBeCloseTo(7, 5);
    expect(heightOf({ building: 'yes' }), "building: 'yes'").toBeCloseTo(12, 5);
  });

  it('AT2: baku has >= 800 buildings, all heights > 0, >= 1 wall and >= 1 water polygon', () => {
    const env = loadEnv('baku');
    expect(env.buildings.length, 'baku buildings').toBeGreaterThanOrEqual(800);
    const badHeight = env.buildings.filter((b) => !(b.height > 0)).length;
    expect(badHeight, 'buildings with height <= 0').toBe(0);
    expect(env.walls.length, 'baku walls').toBeGreaterThanOrEqual(1);
    expect(env.water.length, 'baku water').toBeGreaterThanOrEqual(1);
  }, 120000);

  it('AT3: singapore and lasvegas each have >= 600 buildings, singapore has water, some building >= 150 m tall', () => {
    const singapore = loadEnv('singapore');
    const lasvegas = loadEnv('lasvegas');
    expect(singapore.buildings.length, 'singapore buildings').toBeGreaterThanOrEqual(600);
    expect(lasvegas.buildings.length, 'lasvegas buildings').toBeGreaterThanOrEqual(600);
    expect(singapore.water.length, 'singapore water').toBeGreaterThanOrEqual(1);
    let tallest = 0;
    for (const b of singapore.buildings) if (b.height > tallest) tallest = b.height;
    for (const b of lasvegas.buildings) if (b.height > tallest) tallest = b.height;
    expect(tallest, 'tallest building across singapore and lasvegas').toBeGreaterThanOrEqual(150);
  });

  it('AT4: no env file has a name key or a string value outside the material enum', () => {
    for (const id of IDS) {
      const keys: string[] = [];
      const strings: string[] = [];
      collectStrings(loadEnv(id), keys, strings);
      expect(keys, `${id}: name keys`).not.toContain('name');
      const bad = strings.filter((s) => !(MATERIALS as readonly string[]).includes(s));
      expect(bad, `${id}: non-material strings ${bad.slice(0, 5).join(', ')}`).toHaveLength(0);
    }
  });

  it('AT5: baking baku twice produces a byte-identical env file', () => {
    bake('baku');
    const first = readFileSync(join(ROOT, 'public', 'tracks', 'baku-env.json'));
    bake('baku');
    const second = readFileSync(join(ROOT, 'public', 'tracks', 'baku-env.json'));
    expect(second.equals(first), 'baku-env.json differs between the two bakes').toBe(true);
  }, 600000);
});

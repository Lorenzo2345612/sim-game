import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';

const OSM_BUILDINGS_MODULE = '../../../tools/env/osmBuildings';
type HeightOf = (tags: Record<string, string>) => number;

type P = [number, number];

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

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['baku', 'singapore', 'lasvegas'] as const;

async function loadHeightOf(): Promise<HeightOf> {
  const mod = (await import(OSM_BUILDINGS_MODULE)) as { heightOf: HeightOf };
  return mod.heightOf;
}

const envCache = new Map<string, CityEnv>();
function loadEnv(id: string): CityEnv {
  let env = envCache.get(id);
  if (!env) {
    env = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), 'utf8'),
    ) as CityEnv;
    envCache.set(id, env);
  }
  return env;
}

const trackCache = new Map<string, TrackDataV2>();
function loadTrack(id: string): TrackDataV2 {
  let track = trackCache.get(id);
  if (!track) {
    track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
    ) as TrackDataV2;
    trackCache.set(id, track);
  }
  return track;
}

function orient(a: P, b: P, c: P): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t =
    len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function segSegDist(a: P, b: P, c: P, d: P): number {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    pointSegDist(a, c, d),
    pointSegDist(b, c, d),
    pointSegDist(c, a, b),
    pointSegDist(d, a, b),
  );
}

function ringMinDistToCenterline(ring: P[], centerline: P[]): number {
  const n = centerline.length;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < n; j++) {
      const c = centerline[j];
      const d = centerline[(j + 1) % n];
      const dist = segSegDist(a, b, c, d);
      if (dist < best) best = dist;
    }
  }
  return best;
}

function firstVertexLE(a: P, b: P): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
}

function expectSortedByFirstVertex(items: { first: P }[], label: string): void {
  for (let i = 1; i < items.length; i++) {
    expect(
      firstVertexLE(items[i - 1].first, items[i].first),
      `${label}[${i - 1}] first ${items[i - 1].first} > [${i}] first ${items[i].first}`,
    ).toBe(true);
  }
}

function expectHundredthCoords(pts: P[], label: string): void {
  for (let i = 0; i < pts.length; i++) {
    for (const axis of [0, 1]) {
      const v = pts[i][axis];
      expect(
        Math.abs(v * 100 - Math.round(v * 100)),
        `${label}[${i}][${axis}] = ${v} not rounded to 0.01 m`,
      ).toBeLessThan(1e-6);
    }
  }
}

describe('157 city bake edge cases', () => {
  it('EDGE1: heightOf parses bare, decimal and unit-suffixed metres, including zero', async () => {
    const heightOf = await loadHeightOf();
    expect(heightOf({ height: '30' }), "height: '30'").toBeCloseTo(30, 5);
    expect(heightOf({ height: '12.5 m' }), "height: '12.5 m'").toBeCloseTo(12.5, 5);
    expect(heightOf({ height: '40m', building: 'house' }), "height: '40m'").toBeCloseTo(40, 5);
    expect(heightOf({ height: '0 m', building: 'house' }), "height: '0 m'").toBeCloseTo(0, 5);
  });

  it('EDGE2: heightOf applies height over levels over type, with fractional levels', async () => {
    const heightOf = await loadHeightOf();
    expect(
      heightOf({ height: '20 m', 'building:levels': '5', building: 'house' }),
      'height wins over levels and type',
    ).toBeCloseTo(20, 5);
    expect(heightOf({ 'building:levels': '5', building: 'house' }), 'levels win over type').toBeCloseTo(
      16,
      5,
    );
    expect(heightOf({ 'building:levels': '2.5', building: 'hotel' }), 'fractional levels').toBeCloseTo(
      8,
      5,
    );
  });

  it('EDGE3: heightOf falls through to levels then type when the height tag is unparsable or empty', async () => {
    const heightOf = await loadHeightOf();
    expect(heightOf({ height: 'high', 'building:levels': '10' }), 'unparsable height -> levels').toBeCloseTo(
      32,
      5,
    );
    expect(heightOf({ height: 'n/a', building: 'hotel' }), 'unparsable height -> type').toBeCloseTo(40, 5);
    expect(heightOf({ height: '', building: 'house' }), 'empty height -> type').toBeCloseTo(7, 5);
  });

  it('EDGE4: heightOf covers the full type-default table', async () => {
    const heightOf = await loadHeightOf();
    const cases: [Record<string, string>, number][] = [
      [{ building: 'residential' }, 15],
      [{ building: 'apartments' }, 15],
      [{ building: 'commercial' }, 24],
      [{ building: 'retail' }, 24],
      [{ building: 'office' }, 24],
      [{ building: 'hotel' }, 40],
      [{ building: 'house' }, 7],
      [{ building: 'garage' }, 12],
    ];
    for (const [tags, expected] of cases) {
      expect(heightOf(tags), JSON.stringify(tags)).toBeCloseTo(expected, 5);
    }
  });

  it('EDGE5: heightOf does not mutate its tags input', async () => {
    const heightOf = await loadHeightOf();
    const tags = Object.freeze({ height: '10 m', building: 'house' });
    expect(() => heightOf(tags)).not.toThrow();
    heightOf(tags);
    expect(tags).toEqual({ height: '10 m', building: 'house' });
  });

  it('EDGE6: env files expose only the contract fields (no ids, tags or extras)', () => {
    for (const id of IDS) {
      const env = loadEnv(id);
      expect(Object.keys(env).sort(), `${id} env keys`).toEqual(['buildings', 'walls', 'water']);
      for (const b of env.buildings) {
        expect(Object.keys(b).sort(), `${id} building keys`).toEqual(['height', 'material', 'ring']);
      }
      for (const w of env.walls) {
        expect(Object.keys(w).sort(), `${id} wall keys`).toEqual(['height', 'line', 'thickness']);
      }
    }
  });

  it('EDGE7: building heights are positive multiples of 0.1 m and walls are 8 m x 2.5 m', () => {
    for (const id of IDS) {
      const env = loadEnv(id);
      for (const b of env.buildings) {
        expect(b.height > 0, `${id} height ${b.height}`).toBe(true);
        expect(
          Math.abs(b.height * 10 - Math.round(b.height * 10)),
          `${id} height ${b.height} not a 0.1 m multiple`,
        ).toBeLessThan(1e-6);
      }
      for (const w of env.walls) {
        expect(w.height, `${id} wall height`).toBeCloseTo(8, 9);
        expect(w.thickness, `${id} wall thickness`).toBeCloseTo(2.5, 9);
      }
    }
  });

  it('EDGE8: coordinates are rounded to 0.01 m and arrays are sorted by first vertex', () => {
    for (const id of IDS) {
      const env = loadEnv(id);
      expectSortedByFirstVertex(env.buildings.map((b) => ({ first: b.ring[0] })), `${id} buildings`);
      expectSortedByFirstVertex(env.walls.map((w) => ({ first: w.line[0] })), `${id} walls`);
      expectSortedByFirstVertex(env.water.map((poly) => ({ first: poly[0] })), `${id} water`);
      env.buildings.forEach((b, i) => expectHundredthCoords(b.ring, `${id} buildings[${i}].ring`));
      env.walls.forEach((w, i) => expectHundredthCoords(w.line, `${id} walls[${i}].line`));
      env.water.forEach((poly, i) => expectHundredthCoords(poly, `${id} water[${i}]`));
    }
  });

  it('EDGE9: material is glass exactly when height >= 40 (first-match order)', () => {
    for (const id of IDS) {
      const env = loadEnv(id);
      for (const b of env.buildings) {
        const glass = b.material === 'glass';
        const tall = b.height >= 40 - 1e-9;
        expect(glass, `${id} height ${b.height} material ${b.material}`).toBe(tall);
      }
    }
  });

  it(
    'EDGE10: every building ring comes within 600 m of the centerline',
    () => {
      for (const id of IDS) {
        const env = loadEnv(id);
        const centerline = loadTrack(id).centerline;
        for (const b of env.buildings) {
          const minDist = ringMinDistToCenterline(b.ring, centerline);
          expect(
            minDist <= 600.02,
            `${id} ring ${JSON.stringify(b.ring[0])} min dist ${minDist}`,
          ).toBe(true);
        }
      }
    },
    60000,
  );
});

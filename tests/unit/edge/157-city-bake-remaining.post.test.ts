import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { unprojectXZ, type LonLat, type Point2 } from '../../../src/track/geo';
import { bakeCity } from '../../../tools/env/bakeCity';
import {
  buildCityEnv,
  coastlineWaterRings,
  heightOf,
  pointInPolygon,
  type CityEnvParams,
  type OverpassElement,
  type OverpassPoint,
} from '../../../tools/env/osmBuildings';

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['baku', 'singapore', 'lasvegas'] as const;
const ORIGIN: LonLat = [40, 50];
const BBOX: [number, number, number, number] = [0, 0, 10, 10];

function ll(x: number, z: number): OverpassPoint {
  const [lon, lat] = unprojectXZ([x, z], ORIGIN);
  return { lon, lat };
}

function wayEl(id: number, tags: Record<string, string>, geometry: OverpassPoint[]): OverpassElement {
  return { type: 'way', id, tags, geometry };
}

function toPoly(ring: OverpassPoint[]): Point2[] {
  return ring.map((p): Point2 => [p.lon, p.lat]);
}

const TRACK: CityEnvParams = {
  origin: ORIGIN,
  centerline: [
    [0, 0],
    [1000, 0],
    [0, 0],
  ],
  corridorLimit: 50,
  keepRadius: 600,
  bbox: [39, 49, 41, 51],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('157 city bake remaining gaps', () => {
  it('package.json exposes build:env as the tsx bakeCity CLI', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:env']).toBe('tsx tools/env/bakeCity.ts');
  });

  it('npm run build:env without a track id fails with the usage message (offline)', () => {
    let err: unknown;
    try {
      execFileSync('npm', ['run', 'build:env'], { cwd: ROOT, timeout: 60000, encoding: 'utf8' });
    } catch (e) {
      err = e;
    }
    expect(err, 'build:env with no args must fail').toBeDefined();
    expect(String((err as { stderr?: string }).stderr)).toContain('usage');
  }, 70000);

  it('heightOf trims whitespace and strips non-ft suffixes as metres', () => {
    expect(heightOf({ height: '  45 m  ' })).toBeCloseTo(45, 5);
    expect(heightOf({ height: '30yd', building: 'house' })).toBeCloseTo(30, 5);
    expect(heightOf({ height: '12 storeys' })).toBeCloseTo(12, 5);
  });

  it('buildCityEnv drops a historic=citywalls way outside every old-city area (spec step 5)', () => {
    const env = buildCityEnv(
      [wayEl(1, { historic: 'citywalls' }, [ll(100, 100), ll(300, 100)])],
      TRACK,
    );
    expect(env.walls).toEqual([]);
  });

  it('coastlineWaterRings closes a segment crossing the extract with both endpoints outside', () => {
    const rings = coastlineWaterRings(
      [wayEl(1, { natural: 'coastline' }, [{ lon: -5, lat: 5 }, { lon: 15, lat: 5 }])],
      BBOX,
    );
    expect(rings, 'crossing coastline must produce a water ring').toHaveLength(1);
    const ring = toPoly(rings[0]);
    expect(ring.some((p) => p[0] === 0 && p[1] === 5), 'west crossing').toBe(true);
    expect(ring.some((p) => p[0] === 10 && p[1] === 5), 'east crossing').toBe(true);
    expect(ring.some((p) => p[0] === 10 && p[1] === 0), 'east bottom corner').toBe(true);
    expect(ring.some((p) => p[1] === 10), 'no north corners (water on the right)').toBe(false);
    expect(pointInPolygon([5, 2], ring), 'water south of the way').toBe(true);
    expect(pointInPolygon([5, 8], ring), 'land north of the way').toBe(false);
  });

  it('buildCityEnv turns a clipped coastline within the keep radius into water and drops a far one', () => {
    const params: CityEnvParams = {
      ...TRACK,
      bbox: [ll(-100, 0).lon, ll(0, 700).lat, ll(1100, 0).lon, ll(0, -800).lat],
    };
    const near = buildCityEnv(
      [wayEl(1, { natural: 'coastline' }, [ll(-100, -400), ll(1100, -400)])],
      params,
    );
    expect(near.water).toHaveLength(1);
    expect(pointInPolygon([500, 0], near.water[0]), 'water fills the ring on the right-hand side').toBe(true);
    const far = buildCityEnv(
      [wayEl(1, { natural: 'coastline' }, [ll(-100, -700), ll(1100, -700)])],
      params,
    );
    expect(far.water).toEqual([]);
  });

  it('every wall line and water polygon in the committed env files has a vertex within 600 m of the centerline', () => {
    const cell = 120;
    const dist2 = (p: Point2, s: number[]): number => {
      const dx = s[2] - s[0];
      const dz = s[3] - s[1];
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dz) / len2));
      const ex = p[0] - s[0] - t * dx;
      const ez = p[1] - s[1] - t * dz;
      return ex * ex + ez * ez;
    };
    const cells = (centerline: Point2[]): Map<string, number[][]> => {
      const map = new Map<string, number[][]>();
      for (let i = 0; i < centerline.length; i++) {
        const a = centerline[i];
        const b = centerline[(i + 1) % centerline.length];
        const seg = [a[0], a[1], b[0], b[1]];
        for (let cx = Math.floor(Math.min(a[0], b[0]) / cell); cx <= Math.floor(Math.max(a[0], b[0]) / cell); cx++) {
          for (let cz = Math.floor(Math.min(a[1], b[1]) / cell); cz <= Math.floor(Math.max(a[1], b[1]) / cell); cz++) {
            const key = `${cx},${cz}`;
            const list = map.get(key);
            if (list) list.push(seg);
            else map.set(key, [seg]);
          }
        }
      }
      return map;
    };
    const within = (map: Map<string, number[][]>, pts: Point2[]): boolean => {
      const limit2 = 600.02 * 600.02;
      const r = 6;
      for (const p of pts) {
        const cx = Math.floor(p[0] / cell);
        const cz = Math.floor(p[1] / cell);
        let hit = false;
        for (let i = cx - r; i <= cx + r && !hit; i++) {
          for (let j = cz - r; j <= cz + r && !hit; j++) {
            const list = map.get(`${i},${j}`);
            if (!list) continue;
            for (const s of list) {
              if (dist2(p, s) < limit2) {
                hit = true;
                break;
              }
            }
          }
        }
        if (hit) return true;
      }
      return false;
    };
    for (const id of IDS) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as { centerline: Point2[] };
      const env = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), 'utf8'),
      ) as { walls: { line: Point2[] }[]; water: Point2[][] };
      const map = cells(track.centerline);
      const farWalls = env.walls.filter((w) => !within(map, w.line));
      expect(farWalls.length, `${id}: wall lines with no vertex within 600 m`).toBe(0);
      const farWater = env.water.filter((poly) => !within(map, poly));
      expect(
        farWater.length,
        `${id}: water polygons with no vertex within 600 m (first ${JSON.stringify(farWater[0]?.[0])})`,
      ).toBe(0);
    }
  }, 120000);

  it('bakeCity reuses the singapore and lasvegas caches offline and rewrites them byte-identically', async () => {
    for (const id of ['singapore', 'lasvegas'] as const) {
      const calls: unknown[] = [];
      vi.stubGlobal('fetch', (...args: unknown[]) => {
        calls.push(args);
        throw new Error('network disabled in tests');
      });
      const envPath = join(ROOT, 'public', 'tracks', `${id}-env.json`);
      const before = readFileSync(envPath);
      const result = await bakeCity(id);
      expect(calls, `${id}: fetch must not be called when the cache exists`).toHaveLength(0);
      expect(readFileSync(envPath).equals(before), `${id}: bake changed the env file`).toBe(true);
      const env = JSON.parse(before.toString('utf8')) as {
        buildings: unknown[];
        walls: unknown[];
        water: unknown[];
      };
      expect(result).toEqual({
        buildings: env.buildings.length,
        walls: env.walls.length,
        water: env.water.length,
      });
      vi.unstubAllGlobals();
    }
  }, 120000);
});

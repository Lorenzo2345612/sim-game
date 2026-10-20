import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { unprojectXZ, type LonLat, type Point2 } from '../../../src/track/geo';
import type { CityEnv, OverpassElement, OverpassPoint } from '../../../tools/env/osmBuildings';

// 317 changes these signatures; variable specifiers keep typecheck green until then (157 pattern).
const OSM_BUILDINGS_MODULE = '../../../tools/env/osmBuildings';
const BAKE_CITY_MODULE = '../../../tools/env/bakeCity';

type P = [number, number];

interface BuildCityEnvParams {
  origin: LonLat;
  centerline: Point2[];
  corridorAt: (segmentIndex: number) => number;
  keepRadius: number;
  bbox: [number, number, number, number];
}
type BuildCityEnv = (elements: OverpassElement[], params: BuildCityEnvParams) => CityEnv;
type CorridorLimits = (track: TrackDataV2) => Float64Array;

const ROOT = join(__dirname, '..', '..', '..');
const ORIGIN: LonLat = [0, 0];
const KEEP_RADIUS = 600;
const IDS = ['baku', 'singapore', 'lasvegas'] as const;
const BAKE_IDS = ['singapore', 'lasvegas'] as const;

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

function loadEnv(id: string): CityEnv {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), 'utf8'),
  ) as CityEnv;
}

async function loadBuildCityEnv(): Promise<BuildCityEnv> {
  const mod = (await import(OSM_BUILDINGS_MODULE)) as unknown as { buildCityEnv: BuildCityEnv };
  return mod.buildCityEnv;
}

async function loadCorridorLimits(): Promise<CorridorLimits> {
  const mod = (await import(BAKE_CITY_MODULE)) as unknown as { corridorLimits: CorridorLimits };
  return mod.corridorLimits;
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

function aabbGap2(a: P, b: P, c: P, d: P): number {
  const gapX = Math.max(
    0,
    Math.min(a[0], b[0]) - Math.max(c[0], d[0]),
    Math.min(c[0], d[0]) - Math.max(a[0], b[0]),
  );
  const gapZ = Math.max(
    0,
    Math.min(a[1], b[1]) - Math.max(c[1], d[1]),
    Math.min(c[1], d[1]) - Math.max(a[1], b[1]),
  );
  return gapX * gapX + gapZ * gapZ;
}

function openRing(ring: P[]): P[] {
  const last = ring[ring.length - 1];
  return ring.length > 1 && ring[0][0] === last[0] && ring[0][1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function centroid(ring: P[]): P {
  const pts = openRing(ring);
  let sx = 0;
  let sz = 0;
  for (const p of pts) {
    sx += p[0];
    sz += p[1];
  }
  return [sx / pts.length, sz / pts.length];
}

function distToCenterline(p: P, centerline: P[]): number {
  let best = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const d = pointSegDist(p, centerline[i], centerline[(i + 1) % centerline.length]);
    if (d < best) best = d;
  }
  return best;
}

function countCentroidUnder100(id: string): number {
  const env = loadEnv(id);
  const centerline = loadTrack(id).centerline;
  let count = 0;
  for (const b of env.buildings) {
    if (distToCenterline(centroid(b.ring), centerline) < 100) count++;
  }
  return count;
}

function closedWay(id: number, corners: P[], tags: Record<string, string>): OverpassElement {
  const pts = corners.map(([x, z]): OverpassPoint => {
    const [lon, lat] = unprojectXZ([x, z], ORIGIN);
    return { lon, lat };
  });
  return {
    type: 'way',
    id,
    tags,
    geometry: [...pts, { lon: pts[0].lon, lat: pts[0].lat }],
  };
}

function maxCorridor(limits: Float64Array): number {
  let m = 0;
  for (const v of limits) if (v > m) m = v;
  return m;
}

function bake(ids: string[]): void {
  execFileSync('npm', ['run', 'build:env', '--', ...ids], { cwd: ROOT, timeout: 240000 });
}

describe('317 city bake local corridor acceptance', () => {
  it('AT1: keeps the 10x10 building by the 4 m barriers and drops the one by the 38 m barriers', async () => {
    const buildCityEnv = await loadBuildCityEnv();
    const corridorLimits = await loadCorridorLimits();
    const centerline: Point2[] = [];
    for (let i = 0; i <= 200; i++) centerline.push([i * 5, 0]);
    const track = {
      widthMeters: 12,
      centerline,
      barriers: [
        { start: 0, end: 20, side: 'left', type: 'wall', offsetMeters: 38 },
        { start: 0, end: 20, side: 'right', type: 'wall', offsetMeters: 38 },
        { start: 21, end: 200, side: 'left', type: 'armco', offsetMeters: 4 },
        { start: 21, end: 200, side: 'right', type: 'armco', offsetMeters: 4 },
      ],
    } as unknown as TrackDataV2;
    const limits = corridorLimits(track);
    const env = buildCityEnv(
      [
        closedWay(1, [[495, 15], [505, 15], [505, 25], [495, 25]], { building: 'yes', height: '10' }),
        closedWay(2, [[45, 15], [55, 15], [55, 25], [45, 25]], { building: 'yes', height: '10' }),
      ],
      {
        origin: ORIGIN,
        centerline,
        corridorAt: (i: number) => limits[i],
        keepRadius: KEEP_RADIUS,
        bbox: [-180, -90, 180, 90],
      },
    );
    expect(env.buildings, 'buildings kept').toHaveLength(1);
    const kept = centroid(env.buildings[0].ring);
    expect(kept[0], 'kept centroid x').toBeCloseTo(500, 5);
    expect(kept[1], 'kept centroid z').toBeCloseTo(20, 5);
  });

  it('AT2: baku has >= 150 buildings whose ring centroid is < 100 m from the centerline', () => {
    expect(
      countCentroidUnder100('baku'),
      'baku buildings with centroid < 100 m',
    ).toBeGreaterThanOrEqual(150);
  }, 120000);

  it('AT3: every ring edge is >= the local corridor of its nearest centerline segment (1e-6)', async () => {
    const corridorLimits = await loadCorridorLimits();
    const tol = 1e-6;
    for (const id of IDS) {
      const track = loadTrack(id);
      const env = loadEnv(id);
      const centerline = track.centerline;
      const limits = corridorLimits(track);
      const n = centerline.length;
      const g2max = maxCorridor(limits) ** 2;
      const bad: string[] = [];
      for (const b of env.buildings) {
        const ring = openRing(b.ring);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const c = ring[(i + 1) % ring.length];
          let best = Infinity;
          let bestJ = -1;
          for (let j = 0; j < n; j++) {
            const s0 = centerline[j];
            const s1 = centerline[(j + 1) % n];
            if (aabbGap2(a, c, s0, s1) >= g2max) continue;
            const d = segSegDist(a, c, s0, s1);
            if (d < best) {
              best = d;
              bestJ = j;
            }
          }
          if (bestJ < 0) continue;
          if (best < limits[bestJ] - tol) {
            bad.push(
              `${id}: edge (${a[0]},${a[1]})-(${c[0]},${c[1]}) seg ${bestJ} d=${best} limit=${limits[bestJ]}`,
            );
          }
        }
      }
      expect(bad.length, `${id}: edges closer than the local corridor: ${bad.slice(0, 5).join('; ')}`).toBe(0);
    }
  }, 300000);

  it('AT4: singapore has > 4 and lasvegas > 2 buildings with centroid < 100 m', () => {
    expect(countCentroidUnder100('singapore'), 'singapore near count').toBeGreaterThan(4);
    expect(countCentroidUnder100('lasvegas'), 'lasvegas near count').toBeGreaterThan(2);
  }, 120000);

  it('AT5: baking singapore and lasvegas twice from the cache is byte-identical', () => {
    bake([...BAKE_IDS]);
    const first = BAKE_IDS.map((id) =>
      readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`)),
    );
    bake([...BAKE_IDS]);
    const second = BAKE_IDS.map((id) =>
      readFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`)),
    );
    for (let i = 0; i < BAKE_IDS.length; i++) {
      expect(second[i].equals(first[i]), `${BAKE_IDS[i]}-env.json differs between bakes`).toBe(true);
    }
  }, 600000);
});


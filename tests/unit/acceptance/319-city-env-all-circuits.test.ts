import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import type { CityEnv } from '../../../tools/env/osmBuildings';
import { corridorLimits } from '../../../tools/env/bakeCity';

type P = [number, number];

const ROOT = join(__dirname, '..', '..', '..');
const TRACKS_DIR = join(ROOT, 'public', 'tracks');
const MAX_BUILDINGS = 1500;
const PRE_319 = new Set([
  'baku',
  'singapore',
  'lasvegas',
  'ermita-centro',
  'ermita-federal',
  'ermita-mixto',
  'ermita-norte',
  'ermita-poniente',
  'ermita-veloz',
]);
// sha256 of the committed 317 output (baked without the cap).
const SHA_317: Record<string, string> = {
  baku: '196aa30b1451bf877af038585d5c02d98e7afde3d36135fbe87358ca36d43d86',
  singapore: 'af9a03450bca7fd702cd7504302aae4b077ff500aab0401677a1020405b3ac54',
  lasvegas: '5ca2cf7e1b74ce20904ad118756de8eb18e0c7e851a30271388023ac9fe73dc6',
};

function trackIds(): string[] {
  return readdirSync(TRACKS_DIR)
    .filter(
      (f) =>
        f.endsWith('.json') &&
        !f.endsWith('.style.json') &&
        !f.endsWith('-env.json') &&
        f !== 'index.json',
    )
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

function bakedIn319(): string[] {
  return trackIds().filter((id) => !PRE_319.has(id));
}

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(TRACKS_DIR, `${id}.json`), 'utf8')) as TrackDataV2;
}

function loadEnv(id: string): CityEnv {
  return JSON.parse(readFileSync(join(TRACKS_DIR, `${id}-env.json`), 'utf8')) as CityEnv;
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

function countCentroidUnder(id: string, metres: number): number {
  const env = loadEnv(id);
  const centerline = loadTrack(id).centerline;
  let count = 0;
  for (const b of env.buildings) {
    if (distToCenterline(centroid(b.ring), centerline) < metres) count++;
  }
  return count;
}

function maxCorridor(limits: Float64Array): number {
  let m = 0;
  for (const v of limits) if (v > m) m = v;
  return m;
}

describe('319 city env all circuits acceptance', () => {
  it('AT1: every track JSON in public/tracks/ has a <id>-env.json', () => {
    const missing = trackIds().filter((id) => !existsSync(join(TRACKS_DIR, `${id}-env.json`)));
    expect(missing, 'tracks without env file').toEqual([]);
  });

  it('AT2: every env baked in this task has <= 1500 buildings and every ring edge >= the 317 local corridor (1e-6)', () => {
    const tol = 1e-6;
    for (const id of bakedIn319()) {
      const track = loadTrack(id);
      const env = loadEnv(id);
      expect(env.buildings.length, `${id}: buildings`).toBeLessThanOrEqual(MAX_BUILDINGS);
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
      expect(
        bad.length,
        `${id}: edges closer than the local corridor: ${bad.slice(0, 5).join('; ')}`,
      ).toBe(0);
    }
  }, 600000);

  it('AT3: monza and mexico each have >= 100 buildings with centroid < 300 m of the centerline', () => {
    for (const id of ['monza', 'mexico']) {
      expect(countCentroidUnder(id, 300), `${id}: buildings with centroid < 300 m`).toBeGreaterThanOrEqual(
        100,
      );
    }
  }, 120000);

  it('AT5: baku, singapore and lasvegas env files are byte-identical to the 317 output', () => {
    for (const [id, sha] of Object.entries(SHA_317)) {
      const digest = createHash('sha256')
        .update(readFileSync(join(TRACKS_DIR, `${id}-env.json`)))
        .digest('hex');
      expect(digest, `${id}-env.json sha256 vs 317`).toBe(sha);
    }
  });
});

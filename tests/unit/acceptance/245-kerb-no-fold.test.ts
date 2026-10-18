import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces, halfWidthAt } from '../../../src/track/surfaces';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

// Closed loop: straight A every 2 m, left semicircle centred (200,-R), straight B
// every 2 m, left semicircle centred (0,-R); arc endpoints shared, not duplicated.
function stadium(R: number): TrackDataV2 {
  const m = Math.max(12, Math.ceil(Math.PI * R));
  const centerline: [number, number][] = [];
  for (let i = 0; i < 100; i++) centerline.push([2 * i, 0]);
  for (let j = 0; j < m; j++) {
    const phi = Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([200 + R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  for (let i = 0; i < 100; i++) centerline.push([200 - 2 * i, -2 * R]);
  for (let j = 0; j < m; j++) {
    const phi = -Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  const n = centerline.length;
  const lengthMeters = Math.round(400 + Math.PI * R);
  return {
    ...fixture,
    id: `stadium-r${R}`,
    name: `Stadium R${R}`,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    lengthMeters,
    officialLengthMeters: lengthMeters,
    elevation: new Array<number>(n).fill(0),
    kerbs: [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
  };
}

function kerbStrips(track: TrackDataV2): SurfaceStrip[] {
  return buildTrackSurfaces(track).filter((s) => s.surface === 'kerb');
}

function kerbVertices(strips: SurfaceStrip[]): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const s of strips) {
    for (let i = 0; i < s.positions.length; i += 3) {
      out.push({ x: s.positions[i], z: s.positions[i + 2] });
    }
  }
  return out;
}

function kerbCentroids(strips: SurfaceStrip[]): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const s of strips) {
    const p = s.positions;
    for (let t = 0; t + 2 < s.indices.length; t += 3) {
      const a = 3 * s.indices[t];
      const b = 3 * s.indices[t + 1];
      const c = 3 * s.indices[t + 2];
      out.push({ x: (p[a] + p[b] + p[c]) / 3, z: (p[a + 2] + p[b + 2] + p[c + 2]) / 3 });
    }
  }
  return out;
}

/** Nearest centerline sample by XZ distance; grid-bucketed, full scan when the 3x3 misses. */
function nearestCenterline(track: TrackDataV2): (x: number, z: number) => { d: number; i: number } {
  const n = track.centerline.length;
  const cell = 30;
  const grid = new Map<string, number[]>();
  track.centerline.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  return (x, z) => {
    let d = Infinity;
    let i = -1;
    const consider = (k: number): void => {
      const p = track.centerline[k];
      const dist = Math.hypot(x - p[0], z - p[1]);
      if (dist < d) {
        d = dist;
        i = k;
      }
    };
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const k of grid.get(`${gx + a},${gz + b}`) ?? []) consider(k);
      }
    }
    if (i < 0) for (let k = 0; k < n; k++) consider(k);
    return { d, i };
  };
}

describe('245 kerbs never fold over the asphalt', () => {
  it('AT1: STADIUM(30) kerb vertices sit at lateral 6 or 7.2 m (±1e-4) from their centerline row', () => {
    const track = stadium(30);
    const nearest = nearestCenterline(track);
    const verts = kerbVertices(kerbStrips(track));
    expect(verts.length).toBeGreaterThan(0);
    for (const v of verts) {
      const { d } = nearest(v.x, v.z);
      expect(
        Math.abs(d - 6) < 1e-4 || Math.abs(d - 7.2) < 1e-4,
        `vertex (${v.x}, ${v.z}) lateral ${d}`,
      ).toBe(true);
    }
  });

  it('AT2: STADIUM(7.5) kerb vertices within 10 m of a bend centre stay at least 0.75 m from it and at least one exists', () => {
    const track = stadium(7.5);
    const centres: Array<[number, number]> = [
      [200, -7.5],
      [0, -7.5],
    ];
    const verts = kerbVertices(kerbStrips(track));
    let within = 0;
    for (const v of verts) {
      for (const [cx, cz] of centres) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (d < 10) {
          within++;
          expect(d, `vertex (${v.x}, ${v.z}) vs centre (${cx}, ${cz})`).toBeGreaterThanOrEqual(0.75 - 1e-4);
        }
      }
    }
    expect(within).toBeGreaterThan(0);
  });

  it('AT3: STADIUM(7) has no kerb vertex within 6.5 m of a bend centre and keeps outer vertices at 13 and 14.2 m', () => {
    const track = stadium(7);
    const centres: Array<[number, number]> = [
      [200, -7],
      [0, -7],
    ];
    const verts = kerbVertices(kerbStrips(track));
    for (const v of verts) {
      for (const [cx, cz] of centres) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        expect(d, `vertex (${v.x}, ${v.z}) near centre (${cx}, ${cz})`).toBeGreaterThanOrEqual(6.5);
      }
    }
    let at13 = 0;
    let at142 = 0;
    for (const v of verts) {
      for (const [cx, cz] of centres) {
        const d = Math.hypot(v.x - cx, v.z - cz);
        if (Math.abs(d - 13) <= 1e-6) at13++;
        if (Math.abs(d - 14.2) <= 1e-6) at142++;
      }
    }
    expect(at13).toBeGreaterThan(0);
    expect(at142).toBeGreaterThan(0);
  });

  it('AT4: STADIUM(30)/(7.5)/(7) kerb triangle centroids keep clearance at least 6 m', () => {
    for (const R of [30, 7.5, 7]) {
      const track = stadium(R);
      const nearest = nearestCenterline(track);
      const centroids = kerbCentroids(kerbStrips(track));
      expect(centroids.length, `R=${R} kerb triangles`).toBeGreaterThan(0);
      for (const c of centroids) {
        const { d } = nearest(c.x, c.z);
        expect(d, `R=${R} centroid (${c.x}, ${c.z})`).toBeGreaterThanOrEqual(6 - 1e-6);
      }
    }
  });

  it(
    'AT5: every track kerb triangle centroid keeps clearance at least halfNear - 0.3 m',
    () => {
      const index = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
      ) as Array<{ id: string }>;
      expect(index.length).toBeGreaterThan(0);
      for (const { id } of index) {
        const raw = JSON.parse(
          readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
        );
        const track = parseTrackData(raw) as TrackDataV2;
        const nearest = nearestCenterline(track);
        for (const c of kerbCentroids(kerbStrips(track))) {
          const { d, i } = nearest(c.x, c.z);
          const halfNear = Math.min(
            halfWidthAt(track, 'left', i),
            halfWidthAt(track, 'right', i),
          );
          expect(d, `${id} centroid (${c.x}, ${c.z}) halfNear ${halfNear}`).toBeGreaterThanOrEqual(halfNear - 0.3);
        }
      }
    },
    120000,
  );

  it('AT6: src/track/surfaces.ts imports nothing from three', () => {
    const src = readFileSync(join(ROOT, 'src', 'track', 'surfaces.ts'), 'utf8');
    expect(src.includes("from 'three'")).toBe(false);
  });
});

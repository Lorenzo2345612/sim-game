import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { RunoffSegment, Side, SurfaceStrip, Terrain, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import { initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { GRAVITY, KERB_WIDTH } from '../../../src/core/constants';
import { fixture } from './022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;
// Positions are Float32Array; radial distances up to 118 on the ring carry ~7.7e-6 of quantization.
const R_TOL = 1e-5;

function circleV2(elevation: number[], kerbs: TrackSegment[], runoffs: RunoffSegment[]): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation,
    kerbs,
    runoffs,
  };
}

function zeros(): number[] {
  return Array.from({ length: N }, () => 0);
}

function oneSurface(strips: SurfaceStrip[], surface: SurfaceStrip['surface']): SurfaceStrip {
  const found = strips.filter((s) => s.surface === surface);
  expect(found.length).toBe(1);
  return found[0];
}

function radial(strip: SurfaceStrip, v: number): number {
  return Math.hypot(strip.positions[3 * v], strip.positions[3 * v + 2]);
}

/** Centerline index of a ring point, for strips whose rows sit on the radial lines. */
function indexAt(x: number, z: number): number {
  let idx = Math.round(Math.atan2(z, x) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

const CELL = 60;

function buildIndexGrid(cx: [number, number][]): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < cx.length; i++) {
    const key = `${Math.floor(cx[i][0] / CELL)},${Math.floor(cx[i][1] / CELL)}`;
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [i]);
    else list.push(i);
  }
  return grid;
}

function nearestCenterlineIndex(cx: [number, number][], grid: Map<string, number[]>, x: number, z: number): number {
  const gi = Math.floor(x / CELL);
  const gj = Math.floor(z / CELL);
  let best = -1;
  let bestD = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const list = grid.get(`${gi + di},${gj + dj}`);
      if (list === undefined) continue;
      for (const j of list) {
        const dx = cx[j][0] - x;
        const dz = cx[j][1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
  }
  return best;
}

function indexDiff(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/** Largest lateral outer extent of kerbs/runoffs of one side at index idx (surfaces.ts rule). */
function outerExtentAt(track: TrackDataV2, side: Side, idx: number): number {
  const n = track.centerline.length;
  const half = track.widthMeters / 2;
  const covers = (seg: TrackSegment): boolean => {
    const start = ((seg.start % n) + n) % n;
    const end = ((seg.end % n) + n) % n;
    const len = ((end - start + n) % n) + 1;
    return ((idx - start + n) % n) < len;
  };
  const kerb = track.kerbs.some((k) => k.side === side && covers(k));
  let ext = half + (kerb ? KERB_WIDTH : 0);
  for (const seg of track.runoffs) {
    if (seg.side !== side || !covers(seg)) continue;
    ext = Math.max(ext, half + (kerb ? KERB_WIDTH : 0) + seg.widthMeters);
  }
  return ext;
}

function castDown(
  world: RAPIER.World,
  x: number,
  z: number,
  fromY: number,
  length: number,
): { collider: RAPIER.Collider; y: number } | null {
  const hit = world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), length, true);
  return hit === null ? null : { collider: hit.collider, y: fromY - hit.timeOfImpact };
}

function trackWorld(track: TrackDataV2): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addTrackColliders(world, track);
  world.step();
  return world;
}

const ROOT = join(__dirname, '..', '..', '..');

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

// Flat heightfield at elevation - 0.15 spanning the whole ring (radius up to 118).
const RING_TERRAIN: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 300,
  sizeZ: 300,
  rows: 2,
  cols: 2,
  heights: Array.from({ length: 9 }, () => -0.15),
};

describe('096 surface transitions acceptance', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: left gravel runoff 10..30 of width 12 extends to rows 9..31 (23 rows), rows 9 and 31 at radii 106 and 118', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 10, end: 30, side: 'left', surface: 'gravel', widthMeters: 12 }]),
    );
    const s = oneSurface(strips, 'gravel');
    expect(s.positions.length / 3).toBe(46);
    expect(s.positions.length / 6).toBe(23);
    for (let j = 0; j < 23; j++) {
      expect(indexAt(s.positions[6 * j], s.positions[6 * j + 2]), `row ${j} index`).toBe(9 + j);
      expect(indexAt(s.positions[6 * j + 3], s.positions[6 * j + 5]), `row ${j} index`).toBe(9 + j);
    }
    for (const j of [0, 22]) {
      const r0 = radial(s, 2 * j);
      const r1 = radial(s, 2 * j + 1);
      expect(Math.abs(Math.min(r0, r1) - 106)).toBeLessThanOrEqual(R_TOL);
      expect(Math.abs(Math.max(r0, r1) - 118)).toBeLessThanOrEqual(R_TOL);
    }
  });

  it('AT2: downward rays at the chord midpoint of rows 30/31 between adjacent gravel runoffs hit gravel, not the terrain heightfield', () => {
    const track = {
      ...circleV2(zeros(), [], [
        { start: 10, end: 30, side: 'left', surface: 'gravel', widthMeters: 12 },
        { start: 31, end: 50, side: 'left', surface: 'gravel', widthMeters: 18 },
      ]),
      terrain: RING_TERRAIN,
    };
    world = trackWorld(track);
    const cx = track.centerline;
    const mx = (cx[30][0] + cx[31][0]) / 2;
    const mz = (cx[30][1] + cx[31][1]) / 2;
    const [rx, rz] = rightNormalAt(cx, 30);
    for (const lat of [6.5, 12, 17.5]) {
      const hit = castDown(world, mx - rx * lat, mz - rz * lat, 10, 25);
      expect(hit, `ray at left lateral ${lat}`).not.toBeNull();
      expect(surfaceOf(hit!.collider), `surface at left lateral ${lat}`).toBe('gravel');
      expect(hit!.collider.shape.type === RAPIER.ShapeType.HeightField, `terrain exposed at left lateral ${lat}`).toBe(false);
    }
  });

  it('AT3: a left kerb 0..119 covering the whole ring yields exactly 120 kerb rows (no extension)', () => {
    const strips = buildTrackSurfaces(circleV2(zeros(), [{ start: 0, end: 119, side: 'left' }], []));
    const s = oneSurface(strips, 'kerb');
    expect(s.positions.length / 6).toBe(120);
  });

  it('AT4: on monza, spa and silverstone no chord-midpoint ray in the kerb/runoff band hits the terrain heightfield', () => {
    for (const id of ['monza', 'spa', 'silverstone']) {
      const track = loadTrack(id);
      const cx = track.centerline;
      const n = cx.length;
      const half = track.widthMeters / 2;
      const grid = buildIndexGrid(cx);
      world = trackWorld(track);
      const fromY = Math.max(...track.elevation) + 60;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [rx, rz] = rightNormalAt(cx, i);
        const mx = (cx[i][0] + cx[j][0]) / 2;
        const mz = (cx[i][1] + cx[j][1]) / 2;
        for (const side of [1, -1]) {
          const name: Side = side === 1 ? 'right' : 'left';
          const ext = Math.max(outerExtentAt(track, name, i), outerExtentAt(track, name, j));
          for (let t = half + 0.1; t <= ext; t += 0.5) {
            const x = mx + rx * side * t;
            const z = mz + rz * side * t;
            const near = nearestCenterlineIndex(cx, grid, x, z);
            if (near < 0 || indexDiff(near, i, n) > 3) continue;
            const hit = castDown(world, x, z, fromY, 240);
            if (hit === null) continue;
            if (surfaceOf(hit.collider) === null) continue;
            expect(hit.collider.shape.type === RAPIER.ShapeType.HeightField, `terrain exposed at ${id} index ${i} ${name} lateral ${t.toFixed(1)}`).toBe(false);
          }
        }
      }
      world.free();
      world = null;
    }
  }, 240000);
});

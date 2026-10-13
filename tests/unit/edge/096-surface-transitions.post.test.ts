import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { RunoffSegment, SurfaceStrip, Terrain, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import { initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { GRAVITY } from '../../../src/core/constants';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;

function circleV2(kerbs: TrackSegment[], runoffs: RunoffSegment[]): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs,
    runoffs,
  };
}

function rows(s: SurfaceStrip): number {
  return s.positions.length / 6;
}

function indexAt(s: SurfaceStrip, vertex: number): number {
  let idx = Math.round(Math.atan2(s.positions[3 * vertex + 2], s.positions[3 * vertex]) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

function vAt(s: SurfaceStrip, row: number): number {
  return s.uvs[4 * row + 1];
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

const TERRAIN: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 300,
  sizeZ: 300,
  rows: 2,
  cols: 2,
  heights: Array.from({ length: 9 }, () => -0.15),
};

// Unevenly spaced points on a radius-100 circle: chord(2->3) is half of chord(3->4).
const ANGLES = [0, 15, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

function lumpyV2(runoffs: RunoffSegment[]): TrackDataV2 {
  const centerline: [number, number][] = ANGLES.map((d) => {
    const a = (d * Math.PI) / 180;
    return [100 * Math.cos(a), 100 * Math.sin(a)];
  });
  return {
    ...fixture,
    version: 2,
    centerline,
    widthMeters: 12,
    lengthMeters: 0,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs,
  };
}

let world: RAPIER.World | null = null;

function trackWorld(track: TrackDataV2): RAPIER.World {
  world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addTrackColliders(world, track);
  world.step();
  return world;
}

function castDown(w: RAPIER.World, x: number, z: number): { collider: RAPIER.Collider; y: number } | null {
  const hit = w.castRay(new RAPIER.Ray({ x, y: 10, z }, { x: 0, y: -1, z: 0 }), 25, true);
  return hit === null ? null : { collider: hit.collider, y: 10 - hit.timeOfImpact };
}

function expectStripOverSeam(w: RAPIER.World, track: TrackDataV2, a: number, b: number, lat: number, surface: string) {
  const cx = track.centerline;
  const mx = (cx[a][0] + cx[b][0]) / 2;
  const mz = (cx[a][1] + cx[b][1]) / 2;
  const [rx, rz] = rightNormalAt(cx, a);
  const hit = castDown(w, mx - rx * lat, mz - rz * lat);
  expect(hit, `ray chord ${a}/${b} left lateral ${lat}`).not.toBeNull();
  expect(surfaceOf(hit!.collider), `surface chord ${a}/${b} lateral ${lat}`).toBe(surface);
  expect(hit!.collider.shape.type === RAPIER.ShapeType.HeightField, `terrain exposed at chord ${a}/${b}`).toBe(false);
  return hit!.y;
}

describe('096 surface transitions post-code edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('POST1: v of the pre-row equals the true chord(start-1,start) below zero, not a uniform grid step', () => {
    const track = lumpyV2([{ start: 3, end: 5, side: 'left', surface: 'gravel', widthMeters: 12 }]);
    const cx = track.centerline;
    const chord = (a: number, b: number) => Math.hypot(cx[b][0] - cx[a][0], cx[b][1] - cx[a][1]);
    expect(Math.abs(chord(2, 3) - chord(3, 4))).toBeGreaterThan(10);
    const s = buildTrackSurfaces(track).filter((x) => x.surface === 'gravel')[0];
    expect(rows(s)).toBe(5);
    expect(Math.abs(vAt(s, 0) + chord(2, 3) / 10)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(vAt(s, 1))).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(vAt(s, 2) - chord(3, 4) / 10)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(vAt(s, 4) - (chord(3, 4) + chord(4, 5) + chord(5, 6)) / 10)).toBeLessThanOrEqual(1e-4);
  });

  it('POST2: an isolated runoff covers the terrain at both seam bands via its colliders', () => {
    const track = { ...circleV2([], [{ start: 10, end: 30, side: 'left', surface: 'gravel', widthMeters: 12 }]), terrain: TERRAIN };
    const w = trackWorld(track);
    for (const y of [
      expectStripOverSeam(w, track, 9, 10, 10, 'gravel'),
      expectStripOverSeam(w, track, 30, 31, 10, 'gravel'),
    ]) {
      expect(Math.abs(y - 0.01)).toBeLessThanOrEqual(1e-3);
    }
  });

  it('POST3: kerb extra rows are colliders: rays over the start/end seam bands hit kerb at kerb height', () => {
    const track = { ...circleV2([{ start: 10, end: 30, side: 'left' }], []), terrain: TERRAIN };
    const w = trackWorld(track);
    for (const y of [
      expectStripOverSeam(w, track, 9, 10, 6.5, 'kerb'),
      expectStripOverSeam(w, track, 30, 31, 6.5, 'kerb'),
    ]) {
      expect(Math.abs(y - 0.04)).toBeLessThanOrEqual(1e-3);
    }
  });

  it('POST4: a wrapped runoff of n-1 rows (start 50, end 48) gets no extension and skips the single row 49', () => {
    const s = buildTrackSurfaces(
      circleV2([], [{ start: 50, end: 48, side: 'left', surface: 'gravel', widthMeters: 12 }]),
    ).filter((x) => x.surface === 'gravel')[0];
    expect(rows(s)).toBe(N - 1);
    expect(indexAt(s, 0)).toBe(50);
    expect(indexAt(s, 2 * rows(s) - 1)).toBe(48);
    for (let j = 0; j < rows(s); j++) expect(indexAt(s, 2 * j)).not.toBe(49);
  });
});

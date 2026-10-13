import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns, type BarrierVertex } from '../../../src/track/barrierPath';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;

function ringTrack(barriers: BarrierSegment[], elevation: number[] = Array.from({ length: N }, () => 0)): TrackDataV2 {
  return {
    ...fixture,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    officialLengthMeters: circleTrack.officialLengthMeters,
    elevation,
    kerbs: [],
    runoffs: [],
    barriers,
  };
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

// Only the barrier trimesh collider is unregistered in surfaceByHandle.
function barrierColliderCount(world: RAPIER.World): number {
  let count = 0;
  world.forEachCollider((c) => {
    if (surfaceOf(c) === null) count++;
  });
  return count;
}

function ringIndex(cx: [number, number][], x: number, z: number): number {
  let idx = Math.round(Math.atan2(z, x) / ((2 * Math.PI) / cx.length)) % cx.length;
  if (idx < 0) idx += cx.length;
  return idx;
}

describe('086 barrier continuity edge cases', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: right and left vertices sit at centerline + sign·offset·rightNormal, each side from its own segments', () => {
    const track = ringTrack([
      { start: 0, end: 119, side: 'left', type: 'wall', offsetMeters: 20 },
      { start: 0, end: 119, side: 'right', type: 'armco', offsetMeters: 10 },
    ]);
    const cx = circleTrack.centerline;
    const left = barrierRuns(track, 'left');
    expect(left.length).toBe(1);
    expect(left[0].map((v: BarrierVertex) => v.index)).toEqual(Array.from({ length: N }, (_, i) => i));
    for (let i = 0; i < N; i++) {
      const [rx, rz] = rightNormalAt(cx, i);
      expect(Math.abs(left[0][i].x - (cx[i][0] - 20 * rx))).toBeLessThan(1e-9);
      expect(Math.abs(left[0][i].z - (cx[i][1] - 20 * rz))).toBeLessThan(1e-9);
      expect(left[0][i].type).toBe('wall');
    }
    const right = barrierRuns(track, 'right');
    expect(right.length).toBe(1);
    expect(right[0].map((v: BarrierVertex) => v.index)).toEqual(Array.from({ length: N }, (_, i) => i));
    for (let i = 0; i < N; i++) {
      const [rx, rz] = rightNormalAt(cx, i);
      expect(Math.abs(right[0][i].x - (cx[i][0] + 10 * rx))).toBeLessThan(1e-9);
      expect(Math.abs(right[0][i].z - (cx[i][1] + 10 * rz))).toBeLessThan(1e-9);
      expect(right[0][i].type).toBe('armco');
    }
  });

  it('EDGE2: a track with no barriers yields zero runs on both sides', () => {
    const track = ringTrack([]);
    expect(barrierRuns(track, 'left')).toEqual([]);
    expect(barrierRuns(track, 'right')).toEqual([]);
  });

  it('EDGE3: when several segments of a side cover an index, the last one in track.barriers wins', () => {
    const track = ringTrack([
      { start: 0, end: 70, side: 'left', type: 'wall', offsetMeters: 10 },
      { start: 50, end: 119, side: 'left', type: 'armco', offsetMeters: 20 },
    ]);
    const runs = barrierRuns(track, 'left');
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.length).toBe(N);
    expect(run[0].type).toBe('wall');
    expect(Math.hypot(run[0].x, run[0].z)).toBeCloseTo(110, 6);
    expect(run[49].type).toBe('wall');
    expect(Math.hypot(run[49].x, run[49].z)).toBeCloseTo(110, 6);
    expect(run[50].type).toBe('armco');
    expect(Math.hypot(run[50].x, run[50].z)).toBeCloseTo(120, 6);
    expect(run[70].type).toBe('armco');
    expect(Math.hypot(run[119].x, run[119].z)).toBeCloseTo(120, 6);
  });

  it('EDGE4: a segment with end < start covers the wrapped range start..n-1,0..end as one run', () => {
    const track = ringTrack([{ start: 110, end: 10, side: 'left', type: 'armco', offsetMeters: 10 }]);
    const runs = barrierRuns(track, 'left');
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.length).toBe(21);
    expect(run.map((v: BarrierVertex) => v.index)).toEqual(Array.from({ length: 21 }, (_, k) => (110 + k) % N));
    for (const v of run) {
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(110, 6);
    }
  });

  it('EDGE5: two separated covered ranges on one side yield two independent runs with their own offsets', () => {
    const track = ringTrack([
      { start: 0, end: 39, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 60, end: 79, side: 'left', type: 'wall', offsetMeters: 15 },
    ]);
    const runs = barrierRuns(track, 'left');
    expect(runs.length).toBe(2);
    let a: BarrierVertex[] | undefined;
    let b: BarrierVertex[] | undefined;
    for (const r of runs) {
      if (r[0].index === 0) a = r;
      if (r[0].index === 60) b = r;
    }
    expect(a?.length).toBe(40);
    expect(a?.map((v) => v.index)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(a?.[0].type).toBe('armco');
    expect(a && Math.hypot(a[39].x, a[39].z)).toBeCloseTo(110, 6);
    expect(b?.length).toBe(20);
    expect(b?.map((v) => v.index)).toEqual(Array.from({ length: 20 }, (_, k) => 60 + k));
    expect(b?.[0].type).toBe('wall');
    expect(b && Math.hypot(b[19].x, b[19].z)).toBeCloseTo(115, 6);
  });

  it('EDGE6: vertex y equals elevation[i] when present and 0 when the elevation array is shorter', () => {
    const el = Array.from({ length: N }, (_, i) => ((i * 13) % 29) * 0.25);
    const seg: BarrierSegment[] = [{ start: 0, end: 119, side: 'left', type: 'armco', offsetMeters: 10 }];
    const runFull = barrierRuns(ringTrack(seg, el), 'left')[0];
    expect(runFull.length).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(runFull[i].y).toBeCloseTo(el[i], 12);
    }
    const short = barrierRuns(ringTrack(seg, Array.from({ length: 60 }, (_, i) => i * 0.1)), 'left')[0];
    expect(short.length).toBe(N);
    expect(short[0].y).toBeCloseTo(0, 12);
    expect(short[59].y).toBeCloseTo(5.9, 12);
    expect(short[60].y).toBeCloseTo(0, 12);
    expect(short[119].y).toBeCloseTo(0, 12);
  });

  it('EDGE7: a single covered index gives a one-vertex run and no collider; two runs still share exactly one trimesh', () => {
    const one = ringTrack([{ start: 30, end: 30, side: 'left', type: 'armco', offsetMeters: 10 }]);
    const runs = barrierRuns(one, 'left');
    expect(runs.length).toBe(1);
    expect(runs[0].length).toBe(1);
    expect(runs[0][0].index).toBe(30);
    expect(Math.hypot(runs[0][0].x, runs[0][0].z)).toBeCloseTo(110, 6);
    world = createPhysicsWorld(one);
    expect(barrierColliderCount(world)).toBe(0);
    world.free();
    world = createPhysicsWorld(
      ringTrack([
        { start: 20, end: 21, side: 'left', type: 'armco', offsetMeters: 10 },
        { start: 60, end: 61, side: 'left', type: 'wall', offsetMeters: 10 },
      ]),
    );
    expect(barrierColliderCount(world)).toBe(1);
  });

  it('EDGE8: the quad joining two types belongs to the wall mesh (second vertex type), not to the armco mesh', () => {
    const track = ringTrack([
      { start: 0, end: 59, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 60, end: 119, side: 'left', type: 'wall', offsetMeters: 20 },
    ]);
    const { group, dispose } = createBarrierObject(track);
    const joinsBoundary = (object: THREE.Mesh): boolean => {
      const pos = object.geometry.getAttribute('position');
      const index = object.geometry.index;
      if (index === null) return false;
      for (let t = 0; t + 2 < index.count; t += 3) {
        let hasV59 = false;
        let hasV60 = false;
        for (let k = 0; k < 3; k++) {
          const v = index.getX(t + k);
          const x = pos.getX(v);
          const z = pos.getZ(v);
          const r = Math.hypot(x, z);
          const idx = ringIndex(circleTrack.centerline, x, z);
          if (idx === 59 && Math.abs(r - 110) <= 0.35) hasV59 = true;
          if (idx === 60 && Math.abs(r - 120) <= 0.35) hasV60 = true;
        }
        if (hasV59 && hasV60) return true;
      }
      return false;
    };
    let hasArmco = false;
    let hasWall = false;
    let armcoJoined = false;
    let wallJoined = false;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.name === 'armco') {
        hasArmco = true;
        armcoJoined = joinsBoundary(object);
      }
      if (object.name === 'wall') {
        hasWall = true;
        wallJoined = joinsBoundary(object);
      }
    });
    dispose();
    expect(hasArmco).toBe(true);
    expect(hasWall).toBe(true);
    expect(wallJoined, 'wall mesh must contain the 59-to-60 quad').toBe(true);
    expect(armcoJoined, 'armco mesh must not own the 59-to-60 quad').toBe(false);
  });

  it('EDGE9: barrierRuns leaves the track object untouched even for unsorted overlapping segments', () => {
    const track = ringTrack([
      { start: 80, end: 20, side: 'left', type: 'wall', offsetMeters: 12 },
      { start: 10, end: 90, side: 'left', type: 'armco', offsetMeters: 7.5 },
      { start: 0, end: 119, side: 'right', type: 'tyres', offsetMeters: 6 },
    ]);
    const before = JSON.stringify(track);
    barrierRuns(track, 'left');
    barrierRuns(track, 'right');
    expect(JSON.stringify(track)).toBe(before);
  });

  it('EDGE10: centerline points with coincident prev/next use the fallback right normal [0,-1] and stay finite', () => {
    const cx: [number, number][] = [0, 1, 2, 3, 4, 5].map((i) =>
      i % 2 === 0 ? [0, 0] : [10, 0],
    ) as [number, number][];
    const track: TrackDataV2 = {
      ...ringTrack([{ start: 0, end: 5, side: 'right', type: 'armco', offsetMeters: 2 }], [0, 0, 0, 0, 0, 0]),
      centerline: cx,
    };
    const runs = barrierRuns(track, 'right');
    expect(runs.length).toBe(1);
    expect(runs[0].length).toBe(6);
    expect(runs[0].map((v: BarrierVertex) => v.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const v of runs[0]) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
      expect(v.x).toBeCloseTo(v.index % 2 === 0 ? 0 : 10, 12);
      expect(v.z).toBeCloseTo(-2, 12);
    }
  });
});

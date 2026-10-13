import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;

function ringTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    officialLengthMeters: circleTrack.officialLengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function ringIndex(x: number, z: number): number {
  let idx = Math.round(Math.atan2(z, x) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

interface Marker {
  idx: number;
  r: number;
}

// Rail vertices sit exactly on the polyline; wall cross-sections reach 0.3 m
// along the path normal, so 0.35 covers both.
function hasTriangleJoining(mesh: THREE.Mesh, a: Marker, b: Marker, tol = 0.35): boolean {
  const pos = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  if (index === null) return false;
  for (let t = 0; t + 2 < index.count; t += 3) {
    let hasA = false;
    let hasB = false;
    for (let k = 0; k < 3; k++) {
      const v = index.getX(t + k);
      const x = pos.getX(v);
      const z = pos.getZ(v);
      const r = Math.hypot(x, z);
      const idx = ringIndex(x, z);
      if (idx === a.idx && Math.abs(r - a.r) <= tol) hasA = true;
      if (idx === b.idx && Math.abs(r - b.r) <= tol) hasB = true;
    }
    if (hasA && hasB) return true;
  }
  return false;
}

function findMesh(group: THREE.Group, name: string): THREE.Mesh | undefined {
  let found: THREE.Mesh | undefined;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name === name) found = object;
  });
  return found;
}

function castOutward(
  world: RAPIER.World,
  cx: [number, number][],
  i: number,
  j: number,
): number | null {
  const mx = (cx[i][0] + cx[j][0]) / 2;
  const mz = (cx[i][1] + cx[j][1]) / 2;
  const len = Math.hypot(mx, mz);
  const hit = world.castRay(
    new RAPIER.Ray({ x: mx, y: 0.5, z: mz }, { x: mx / len, y: 0, z: mz / len }),
    40,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    (c: RAPIER.Collider) => surfaceOf(c) === null,
  );
  return hit === null ? null : hit.timeOfImpact;
}

describe('086 barrier continuity post-code gaps', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('POST1: collider of an open run builds the wrap seam quad and nothing across the uncovered gap', () => {
    world = createPhysicsWorld(
      ringTrack([
        { start: 0, end: 39, side: 'left', type: 'armco', offsetMeters: 10 },
        { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 10 },
      ]),
    );
    world.step();
    const cx = circleTrack.centerline;
    const seam = castOutward(world, cx, 119, 0);
    expect(seam, 'wrap seam 119->0 inside the open run').not.toBeNull();
    expect(seam!).toBeGreaterThanOrEqual(9.5);
    expect(seam!).toBeLessThanOrEqual(10.5);
    expect(castOutward(world, cx, 49, 50), 'no wall across the uncovered gap').toBeNull();
  });

  it('POST2: closed single-type run connects last vertex to first (closing quad with the diagonal offsets)', () => {
    const track = ringTrack([
      { start: 0, end: 59, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 20 },
    ]);
    const { group, dispose } = createBarrierObject(track);
    const armco = findMesh(group, 'armco');
    expect(armco).toBeDefined();
    const joined = hasTriangleJoining(armco!, { idx: 119, r: 120 }, { idx: 0, r: 110 });
    dispose();
    expect(joined, 'armco mesh must close the ring between v119 (r120) and v0 (r110)').toBe(true);
  });

  it('POST3: closing quad of a mixed-type closed run belongs to the type of vertex 0, not the last vertex', () => {
    const track = ringTrack([
      { start: 0, end: 59, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 60, end: 119, side: 'left', type: 'wall', offsetMeters: 20 },
    ]);
    const { group, dispose } = createBarrierObject(track);
    const armco = findMesh(group, 'armco')!;
    const wall = findMesh(group, 'wall')!;
    const armcoCloses = hasTriangleJoining(armco, { idx: 119, r: 120 }, { idx: 0, r: 110 });
    const wallCloses = hasTriangleJoining(wall, { idx: 119, r: 120 }, { idx: 0, r: 110 });
    dispose();
    expect(armcoCloses, 'v119->v0 quad takes vertex 0 type (armco)').toBe(true);
    expect(wallCloses, 'wall must not own the v119->v0 quad').toBe(false);
  });

  it('POST4: open wrapped run with a type change at the seam: joining quad in the second type, open ends unjoined', () => {
    const track = ringTrack([
      { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 0, end: 39, side: 'left', type: 'wall', offsetMeters: 20 },
    ]);
    const { group, dispose } = createBarrierObject(track);
    const armco = findMesh(group, 'armco')!;
    const wall = findMesh(group, 'wall')!;
    const seam = { a: { idx: 119, r: 110 }, b: { idx: 0, r: 120 } };
    const wallJoinsSeam = hasTriangleJoining(wall, seam.a, seam.b);
    const armcoJoinsSeam = hasTriangleJoining(armco, seam.a, seam.b);
    const openEnd = { a: { idx: 39, r: 120 }, b: { idx: 60, r: 110 } };
    const wallJoinsOpenEnd = hasTriangleJoining(wall, openEnd.a, openEnd.b);
    const armcoJoinsOpenEnd = hasTriangleJoining(armco, openEnd.a, openEnd.b);
    dispose();
    expect(wallJoinsSeam, 'v119->v0 quad takes vertex 0 type (wall)').toBe(true);
    expect(armcoJoinsSeam, 'armco must not own the seam quad').toBe(false);
    expect(wallJoinsOpenEnd, 'open run must not join its ends (wall)').toBe(false);
    expect(armcoJoinsOpenEnd, 'open run must not join its ends (armco)').toBe(false);
  });

  it('POST5: tyre stacks are sampled along the span, starting at the seam vertex of the previous type', () => {
    const track = ringTrack([
      { start: 0, end: 19, side: 'left', type: 'wall', offsetMeters: 20 },
      { start: 20, end: 39, side: 'left', type: 'tyres', offsetMeters: 20 },
    ]);
    const v19 = barrierRuns(track, 'left')[0][19];
    expect(v19.index).toBe(19);
    expect(v19.type).toBe('wall');
    const { group, dispose } = createBarrierObject(track);
    const tyres = findMesh(group, 'tyres') as THREE.InstancedMesh;
    expect(tyres).toBeDefined();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let atSeam = false;
    for (let i = 0; i < tyres.count; i++) {
      tyres.getMatrixAt(i, m);
      m.decompose(p, q, s);
      if (Math.hypot(p.x - v19.x, p.z - v19.z) < 1e-3) atSeam = true;
    }
    dispose();
    expect(atSeam, 'first tyre stack sits on the wall->tyres seam vertex').toBe(true);
  });
});

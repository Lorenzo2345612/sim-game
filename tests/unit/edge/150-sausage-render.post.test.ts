import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RAPIER, createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import type { Sausage, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

interface SausageObject {
  group: THREE.Group;
  count: number;
  dispose(): void;
}
interface SausageRenderer {
  createSausageGeometry(length: number): THREE.BufferGeometry;
  createSausageBodyGeometry(): THREE.BufferGeometry;
  createSausages(track: TrackDataV2): SausageObject;
  sausagePose(track: TrackDataV2, s: Sausage): { position: { x: number; y: number; z: number }; yaw: number };
}

async function loadSausageRenderer(): Promise<SausageRenderer> {
  return (await import('../../../src/render/sausageRenderer')) as SausageRenderer;
}

const POINTS = 60;

// Same straight as the 150 edge tests: 60 points 2 m apart along -Z, tangent -Z, right normal +X.
function straightTrack(o: { sausages?: Sausage[]; elevation?: number[] } = {}): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: POINTS }, (_, i) => [0, -2 * i]);
  const track: TrackDataV2 = {
    ...fixture,
    centerline,
    lengthMeters: 236,
    elevation: o.elevation ?? centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
  };
  if (o.sausages !== undefined) track.sausages = o.sausages;
  return track;
}

// Closed rectangle, 10 points, 10 m spacing (032-post): index 0 and 9 sit on the
// seam, so only wrapped neighbors yield finite tangents.
const RECT: [number, number][] = [
  [0, 0], [0, -10], [0, -20], [0, -30],
  [10, -30], [20, -30], [20, -20], [20, -10], [20, 0], [10, 0],
];

function loopTrack(sausages: Sausage[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: RECT,
    lengthMeters: 100,
    elevation: RECT.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    sausages,
  };
}

// Out-and-back spike at index 2: p1 === p3, so the central difference is zero.
const SPIKE: [number, number][] = [
  [0, 0], [0, -10], [0, -20], [0, -10], [0, -22], [10, -22], [10, 0],
];

function spikeTrack(): TrackDataV2 {
  return {
    ...fixture,
    centerline: SPIKE,
    lengthMeters: 50,
    elevation: SPIKE.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    sausages: [{ index: 2, side: 'right', offset: 5, length: 6 }],
  };
}

type World = ReturnType<typeof createPhysicsWorld>;

describe('150 sausage kerb render and colliders post-code gaps', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('POST1: sausagePose wraps neighbours across the closed-loop seam at index 0 and the last index', async () => {
    const mod = await loadSausageRenderer();
    const track = loopTrack([]);
    const first = mod.sausagePose(track, { index: 0, side: 'right', offset: 4, length: 6 });
    const s = Math.SQRT1_2;
    expect(first.position.x).toBeCloseTo(4 * s, 5);
    expect(first.position.y).toBeCloseTo(0, 6);
    expect(first.position.z).toBeCloseTo(-4 * s, 5);
    expect(Math.sin(first.yaw)).toBeCloseTo(-s, 5);
    expect(Math.cos(first.yaw)).toBeCloseTo(-s, 5);
    const last = mod.sausagePose(track, { index: RECT.length - 1, side: 'right', offset: 4, length: 6 });
    expect(last.position.x).toBeCloseTo(10, 5);
    expect(last.position.y).toBeCloseTo(0, 6);
    expect(last.position.z).toBeCloseTo(-4, 5);
    expect(Math.sin(last.yaw)).toBeCloseTo(-1, 5);
    expect(Math.cos(last.yaw)).toBeCloseTo(0, 5);
  });

  it('POST2: a zero offset sits on the centerline and still aims along the tangent', async () => {
    const mod = await loadSausageRenderer();
    const pose = mod.sausagePose(straightTrack(), { index: 15, side: 'right', offset: 0, length: 6 });
    expect(pose.position.x).toBeCloseTo(0, 6);
    expect(pose.position.y).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-30, 6);
    expect(Math.sin(pose.yaw)).toBeCloseTo(0, 6);
    expect(Math.cos(pose.yaw)).toBeCloseTo(-1, 6);
  });

  it('POST3: sausagePose falls back to the -Z tangent when the neighbours coincide', async () => {
    const mod = await loadSausageRenderer();
    const pose = mod.sausagePose(spikeTrack(), { index: 2, side: 'right', offset: 5, length: 6 });
    expect(pose.position.x).toBeCloseTo(5, 6);
    expect(pose.position.y).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(-20, 6);
    expect(Math.sin(pose.yaw)).toBeCloseTo(0, 6);
    expect(Math.cos(pose.yaw)).toBeCloseTo(-1, 6);
  });

  it('POST4: out-of-range sausage indices wrap into the centerline', async () => {
    const mod = await loadSausageRenderer();
    const track = straightTrack();
    const base = mod.sausagePose(track, { index: 0, side: 'right', offset: 2.5, length: 6 });
    const wrappedHigh = mod.sausagePose(track, { index: POINTS, side: 'right', offset: 2.5, length: 6 });
    const wrappedLow = mod.sausagePose(track, { index: -1, side: 'right', offset: 2.5, length: 6 });
    expect(wrappedHigh.position.x).toBeCloseTo(base.position.x, 6);
    expect(wrappedHigh.position.y).toBeCloseTo(base.position.y, 6);
    expect(wrappedHigh.position.z).toBeCloseTo(base.position.z, 6);
    expect(Math.sin(wrappedHigh.yaw)).toBeCloseTo(Math.sin(base.yaw), 6);
    expect(Math.cos(wrappedHigh.yaw)).toBeCloseTo(Math.cos(base.yaw), 6);
    expect(wrappedLow.position.x).toBeCloseTo(-2.5, 6);
    expect(wrappedLow.position.y).toBeCloseTo(0, 6);
    expect(wrappedLow.position.z).toBeCloseTo(-2 * (POINTS - 1), 6);
  });

  it('POST5: mixed lengths get one InstancedMesh over every piece with vertex colours and no shadow draw', async () => {
    const mod = await loadSausageRenderer();
    const track = straightTrack({
      sausages: [
        { index: 10, side: 'right', offset: 7.8, length: 6 },
        { index: 20, side: 'left', offset: 7.8, length: 2.4 },
        { index: 30, side: 'right', offset: 7.8, length: 6 },
      ],
    });
    const obj = mod.createSausages(track);
    expect(obj.count, 'count = sausages').toBe(3);
    expect(obj.group.children.length, 'one mesh for every piece').toBe(1);
    const mesh = obj.group.children[0] as THREE.InstancedMesh;
    expect(mesh, 'mesh child').toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.name).toBe('sausages');
    expect(mesh.count, '6 + 3 + 6 pieces').toBe(15);
    const body = mod.createSausageBodyGeometry();
    body.computeBoundingBox();
    const box = body.boundingBox;
    if (box === null) throw new Error('no bounding box');
    expect(box.max.z - box.min.z, 'body geometry length 1').toBeCloseTo(1, 6);
    body.dispose();
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    expect((material as THREE.MeshStandardMaterial).vertexColors, 'vertex colours on').toBe(true);
    expect(mesh.castShadow, 'no shadow-pass draw').toBe(false);
    obj.dispose();
    expect(() => obj.dispose(), 'second dispose is a no-op').not.toThrow();
  });

  it('POST6: geometry keeps the profile when the caps overlap a sausage shorter than twice the cap', async () => {
    const mod = await loadSausageRenderer();
    const geometry = mod.createSausageGeometry(0.5);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('no bounding box');
    expect(box.min.y).toBeLessThanOrEqual(1e-6);
    expect(box.max.y - 0.13).toBeCloseTo(0, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(0.5, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(0.5, 6);
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i))).toBe(true);
    }
    geometry.dispose();
  });

  it('POST7: a sausage whose elevation entry is missing sits at y 0', async () => {
    const mod = await loadSausageRenderer();
    const pose = mod.sausagePose(straightTrack({ elevation: [] }), {
      index: 15,
      side: 'right',
      offset: 7.8,
      length: 6,
    });
    expect(pose.position.y).toBeCloseTo(0, 6);
  });

  it('POST8: every sausage piece adds one kerb collider that does not fall and is hit at its top', async () => {
    const baseline = createPhysicsWorld(straightTrack());
    let baselineKerb = 0;
    baseline.forEachCollider((c) => {
      if (surfaceOf(c) === 'kerb') baselineKerb++;
    });
    baseline.free();
    expect(baselineKerb, 'no sausages, no kerb strips').toBe(0);

    const mod = await loadSausageRenderer();
    const track = straightTrack({
      sausages: [10, 20, 30].map((index) => ({ index, side: 'right' as const, offset: 7.8, length: 6 })),
    });
    world = createPhysicsWorld(track);
    const colliders: RAPIER.Collider[] = [];
    world.forEachCollider((c) => {
      if (surfaceOf(c) === 'kerb') colliders.push(c);
    });
    const expectedColliders = (track.sausages ?? []).reduce(
      (sum, s) => sum + Math.max(1, Math.ceil(s.length)),
      0,
    );
    expect(colliders.length, 'one collider per piece').toBe(expectedColliders);
    for (let i = 0; i < 5; i++) world.step();
    for (const s of track.sausages ?? []) {
      const { position } = mod.sausagePose(track, s);
      const hit = world.castRay(
        new RAPIER.Ray({ x: position.x, y: 5, z: position.z }, { x: 0, y: -1, z: 0 }),
        100,
        true,
      );
      expect(hit, `ray at sausage index ${s.index}`).not.toBeNull();
      if (hit === null) continue;
      expect(surfaceOf(hit.collider), 'kerb surface').toBe('kerb');
      expect(hit.timeOfImpact, 'top 0.13 above ground after steps').toBeCloseTo(4.87, 3);
    }
  });

  it('POST9: a zero-length sausage does not crash world or render creation', async () => {
    const mod = await loadSausageRenderer();
    const track = straightTrack({
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 0 }],
    });
    let obj: SausageObject | undefined;
    expect(() => {
      world = createPhysicsWorld(track);
      obj = mod.createSausages(track);
    }).not.toThrow();
    expect(obj?.count).toBe(1);
    obj?.dispose();
  });
});

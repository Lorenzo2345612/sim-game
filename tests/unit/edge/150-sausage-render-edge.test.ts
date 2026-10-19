import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RAPIER, createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import type { Sausage, TrackDataV2, Vec3 } from '../../../src/core/types';
import { sausagePieces } from '../../../src/track/sausages';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const SAUSAGE_RENDERER_MODULE = '../../../src/render/sausageRenderer';

interface SausageObject { group: THREE.Group; count: number; dispose(): void }
interface SausageRenderer {
  SAUSAGE_CAP_LENGTH: number;
  sausageHullPoints(length: number): Float32Array;
  createSausageGeometry(length: number): THREE.BufferGeometry;
  createSausages(track: TrackDataV2): SausageObject;
  sausagePose(track: TrackDataV2, s: Sausage): { position: Vec3; yaw: number };
}

async function loadSausageRenderer(): Promise<SausageRenderer> {
  return (await import(SAUSAGE_RENDERER_MODULE)) as SausageRenderer;
}

const POINTS = 60;

// Straight track like acceptance 150: 60 points 2 m apart along -Z, so the
// central-difference tangent is -Z and the right normal is +X.
function straightTrack(
  o: { sausages?: Sausage[]; elevation?: number[]; kerbs?: TrackDataV2['kerbs'] } = {},
): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: POINTS }, (_, i) => [0, -2 * i]);
  const track: TrackDataV2 = {
    ...fixture,
    centerline,
    lengthMeters: 236,
    elevation: o.elevation ?? centerline.map(() => 0),
    kerbs: o.kerbs ?? [],
    runoffs: [],
    barriers: [],
  };
  if (o.sausages !== undefined) track.sausages = o.sausages;
  return track;
}

// At index 2 the central difference p3 - p1 = (1, 0, -1) differs from both
// adjacent segment directions, so only the central difference yields the
// expected normal.
function bendTrack(): TrackDataV2 {
  const centerline: [number, number][] = [
    [0, 2], [0, 0], [1, 0], [1, -1], [1, -2], [1, -3],
  ];
  return {
    ...fixture,
    centerline,
    lengthMeters: 12,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
  };
}

type World = ReturnType<typeof createPhysicsWorld>;

describe('150 sausage kerb render and colliders edge', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: sausageHullPoints describes the trapezoid prism for any length', async () => {
    const mod = await loadSausageRenderer();
    for (const length of [6, 2.4]) {
      const pts = mod.sausageHullPoints(length);
      expect(pts.length, `${length} m: eight xyz points`).toBe(24);
      const half = length / 2;
      const base: number[] = [];
      const top: number[] = [];
      for (let i = 0; i < 8; i++) {
        const x = pts[3 * i];
        const y = pts[3 * i + 1];
        const z = pts[3 * i + 2];
        if (Math.abs(y) <= 1e-6) base.push(x, z);
        else if (Math.abs(y - 0.13) <= 1e-6) top.push(x, z);
        else throw new Error(`unexpected hull y ${y}`);
      }
      expect(base.length, 'four base corners').toBe(8);
      expect(top.length, 'four top corners').toBe(8);
      for (let k = 0; k < 4; k++) {
        expect(Math.abs(Math.abs(base[2 * k]) - 0.25), `${length} m base half width`).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(Math.abs(base[2 * k + 1]) - half), `${length} m base z`).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(Math.abs(top[2 * k]) - 0.125), `${length} m top half width`).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(Math.abs(top[2 * k + 1]) - half), `${length} m top z`).toBeLessThanOrEqual(1e-6);
      }
    }
  });

  it('EDGE2: sausage geometry colours the end caps black and the body yellow', async () => {
    const mod = await loadSausageRenderer();
    const length = 6;
    const geometry = mod.createSausageGeometry(length);
    const colors = geometry.getAttribute('color');
    expect(colors, 'color attribute').toBeDefined();
    const pos = geometry.getAttribute('position');
    expect(colors.count, 'one colour per vertex').toBe(pos.count);
    const endZ = length / 2 - 1e-6;
    const innerZ = length / 2 - mod.SAUSAGE_CAP_LENGTH;
    let bodyYellow = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = Math.abs(pos.getZ(i));
      const black = colors.getX(i) < 0.01 && colors.getY(i) < 0.01 && colors.getZ(i) < 0.01;
      if (z >= endZ) expect(black, `cap vertex z=${z} is black`).toBe(true);
      if (z < innerZ) {
        expect(black, `body vertex z=${z} is not black`).toBe(false);
        if (colors.getX(i) > 0.01 && colors.getY(i) > 0.01) bodyYellow++;
      }
    }
    expect(bodyYellow, 'yellow body vertices').toBeGreaterThan(0);
    geometry.dispose();
  });

  it('EDGE3: sausage geometry for a custom length keeps the 0.5 by 0.13 profile', async () => {
    const mod = await loadSausageRenderer();
    const geometry = mod.createSausageGeometry(2.4);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('sausage geometry has no bounding box');
    expect(Math.abs(box.min.y), 'base at y 0').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.y - 0.13), 'height').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.x - box.min.x - 0.5), 'base width').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.z - box.min.z - 2.4), 'length').toBeLessThanOrEqual(1e-6);
    geometry.dispose();
  });

  it('EDGE4: sausagePose offsets by side, takes y from elevation and aims local Z along the tangent', async () => {
    const mod = await loadSausageRenderer();
    const elevation = Array.from({ length: POINTS }, () => 0);
    elevation[15] = 2.5;
    const track = straightTrack({ elevation });
    const right = mod.sausagePose(track, { index: 15, side: 'right', offset: 7.8, length: 6 });
    expect(right.position.x).toBeCloseTo(7.8, 6);
    expect(right.position.y).toBeCloseTo(2.5, 6);
    expect(right.position.z).toBeCloseTo(-30, 6);
    expect(Math.sin(right.yaw)).toBeCloseTo(0, 6);
    expect(Math.cos(right.yaw)).toBeCloseTo(-1, 6);
    const left = mod.sausagePose(track, { index: 15, side: 'left', offset: 7.8, length: 6 });
    expect(left.position.x).toBeCloseTo(-7.8, 6);
    expect(left.position.y).toBeCloseTo(2.5, 6);
    expect(left.position.z).toBeCloseTo(-30, 6);
  });

  it('EDGE5: sausagePose follows the central-difference right normal on a bend', async () => {
    const mod = await loadSausageRenderer();
    const pose = mod.sausagePose(bendTrack(), { index: 2, side: 'right', offset: 5, length: 6 });
    const s = Math.SQRT1_2;
    expect(pose.position.x).toBeCloseTo(1 + 5 * s, 5);
    expect(pose.position.y).toBeCloseTo(0, 6);
    expect(pose.position.z).toBeCloseTo(5 * s, 5);
    expect(Math.sin(pose.yaw)).toBeCloseTo(s, 5);
    expect(Math.cos(pose.yaw)).toBeCloseTo(-s, 5);
  });

  it('EDGE6: createSausages without sausages yields an empty group with count 0', async () => {
    const mod = await loadSausageRenderer();
    const obj = mod.createSausages(straightTrack());
    expect(obj.count).toBe(0);
    expect(obj.group.children.length).toBe(0);
    obj.dispose();
  });

  it('EDGE7: createSausages instances every piece in one mesh and leaves the track untouched', async () => {
    const mod = await loadSausageRenderer();
    const track = straightTrack({
      sausages: [
        { index: 10, side: 'right', offset: 7.8, length: 6 },
        { index: 20, side: 'left', offset: 7.8, length: 6 },
      ],
    });
    const before = JSON.stringify(track);
    const obj = mod.createSausages(track);
    expect(obj.count).toBe(2);
    expect(obj.group.children.length, 'one mesh for all pieces').toBe(1);
    const mesh = obj.group.children[0];
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect((mesh as THREE.InstancedMesh).name).toBe('sausages');
    expect((mesh as THREE.InstancedMesh).count, 'one instance per piece').toBe(12);
    expect(JSON.stringify(track), 'input not mutated').toBe(before);
    obj.dispose();
  });

  it('EDGE8: the instance matrix carries the first piece pose in position and tangent', async () => {
    const mod = await loadSausageRenderer();
    const elevation = Array.from({ length: POINTS }, () => 0);
    elevation[15] = 2.5;
    const track = straightTrack({
      elevation,
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 6 }],
    });
    const first = sausagePieces(track, track.sausages![0])[0];
    const obj = mod.createSausages(track);
    const mesh = obj.group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const e = m.elements;
    expect(e[12]).toBeCloseTo(first.position.x, 5);
    expect(e[13]).toBeCloseTo(first.position.y, 5);
    expect(e[14]).toBeCloseTo(first.position.z, 5);
    expect(e[8], 'local Z x').toBeCloseTo(Math.sin(first.yaw) * first.length, 5);
    expect(e[9], 'local Z y').toBeCloseTo(0, 5);
    expect(e[10], 'local Z z').toBeCloseTo(Math.cos(first.yaw) * first.length, 5);
    obj.dispose();
  });

  it('EDGE9: the sausage collider shares the kerb surface and friction of the kerb strip', async () => {
    const track = straightTrack({
      kerbs: [{ start: 10, end: 20, side: 'right' }],
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 6 }],
    });
    world = createPhysicsWorld(track);
    world.step();
    let kerbColliders = 0;
    world.forEachCollider((c) => {
      if (surfaceOf(c) === 'kerb') kerbColliders++;
    });
    expect(kerbColliders, 'kerb strip collider exists').toBeGreaterThanOrEqual(1);
    const hit = world.castRay(
      new RAPIER.Ray({ x: 7.8, y: 5, z: -30 }, { x: 0, y: -1, z: 0 }),
      100,
      true,
    );
    expect(hit, 'downward ray hits the sausage').not.toBeNull();
    if (hit === null) return;
    expect(Math.abs(hit.timeOfImpact - 4.92), 'sausage top 0.08 above ground').toBeLessThanOrEqual(0.02);
    expect(surfaceOf(hit.collider)).toBe('kerb');
    let stripFriction: number | null = null;
    world.forEachCollider((c) => {
      if (c.handle !== hit.collider.handle && surfaceOf(c) === 'kerb') stripFriction = c.friction();
    });
    expect(stripFriction, 'kerb strip beside the sausage').not.toBeNull();
    if (stripFriction !== null) expect(hit.collider.friction()).toBeCloseTo(stripFriction, 6);
  });

  it('EDGE10: dispose releases the sausage geometry and material', async () => {
    const mod = await loadSausageRenderer();
    const track = straightTrack({
      sausages: [{ index: 15, side: 'right', offset: 7.8, length: 6 }],
    });
    const obj = mod.createSausages(track);
    const mesh = obj.group.children[0] as THREE.InstancedMesh;
    const geoSpy = vi.spyOn(mesh.geometry, 'dispose');
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const matSpy = vi.spyOn(mat, 'dispose');
    obj.dispose();
    expect(geoSpy, 'geometry disposed').toHaveBeenCalled();
    expect(matSpy, 'material disposed').toHaveBeenCalled();
  });
});

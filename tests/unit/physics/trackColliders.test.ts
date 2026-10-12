import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;
const createWorld = createPhysicsWorld as (track?: TrackDataV2) => World;

// Closed rectangle, 60 points, 2 m spacing, index 0 on the west straight
// (x = 0, heading -Z so the right normal is +X).
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 20; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 10; i++) CENTERLINE.push([2 * i, -40]);
for (let i = 1; i <= 20; i++) CENTERLINE.push([20, -40 + 2 * i]);
for (let i = 1; i <= 9; i++) CENTERLINE.push([20 - 2 * i, 0]);

const TERRAIN: Terrain = { originX: 10, originZ: -20, sizeX: 200, sizeZ: 200, rows: 20, cols: 20, heights: new Array(21 * 21).fill(0) };

const track: TrackDataV2 = {
  ...fixture,
  centerline: CENTERLINE,
  lengthMeters: 120,
  elevation: CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [],
  barriers: [{ start: 2, end: 8, side: 'right', type: 'wall', offsetMeters: 11 }],
  terrain: TERRAIN,
};

function castDown(world: World, x: number, z: number): { collider: RAPIER.Collider; y: number } | null {
  const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 200, true);
  return hit === null ? null : { collider: hit.collider, y: 50 - hit.timeOfImpact };
}

describe('trackColliders', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('the Phase 0 ground maps to no surface', () => {
    world = createPhysicsWorld();
    world.step();
    const hit = castDown(world, 3, 3);
    expect(hit).not.toBeNull();
    expect(surfaceOf(hit!.collider)).toBeNull();
  });

  it('a raycast hit on terrain away from the track maps to grass', () => {
    world = createWorld(track);
    world.step();
    const hit = castDown(world, -60, -20);
    expect(hit).not.toBeNull();
    expect(surfaceOf(hit!.collider)).toBe('grass');
  });

  it('a raycast hit on a barrier maps to no surface', () => {
    world = createWorld(track);
    world.step();
    const hit = world.castRay(
      new RAPIER.Ray({ x: 0, y: 0.5, z: -10 }, { x: 1, y: 0, z: 0 }),
      50,
      true,
    );
    expect(hit).not.toBeNull();
    expect(hit!.timeOfImpact).toBeCloseTo(11, 1);
    expect(surfaceOf(hit!.collider)).toBeNull();
  });

  it('two consecutive worlds free cleanly and the second maps fresh surfaces', () => {
    const a = createWorld(track);
    a.step();
    const hitA = castDown(a, 0, -10);
    expect(hitA).not.toBeNull();
    expect(surfaceOf(hitA!.collider)).toBe('asphalt');
    a.free();
    const b = createWorld({
      ...track,
      runoffs: [{ start: 0, end: 8, side: 'right', surface: 'gravel', widthMeters: 4 }],
      barriers: [],
    });
    b.step();
    const gravel = castDown(b, 8, -10);
    expect(gravel).not.toBeNull();
    expect(surfaceOf(gravel!.collider)).toBe('gravel');
    b.free();
    world = createPhysicsWorld();
    let count = 0;
    world.forEachCollider(() => count++);
    expect(count).toBe(1);
  });
});

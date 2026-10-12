import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import type { BarrierSegment, Surface, SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

function flatTerrain(): Terrain {
  return {
    originX: 0,
    originZ: 0,
    sizeX: 100,
    sizeZ: 100,
    rows: 4,
    cols: 4,
    heights: new Array(25).fill(0),
  };
}

// Closed rectangle, 10 points, 10 m spacing; normals at indices 1 and 2 are +X.
const RECT: [number, number][] = [
  [0, 0], [0, -10], [0, -20], [0, -30],
  [10, -30], [20, -30],
  [20, -20], [20, -10], [20, 0],
  [10, 0],
];

// Out-and-back spike at index 2: P[1] === P[3], so the central difference is zero.
const SPIKE: [number, number][] = [
  [0, 0], [0, -10], [0, -20], [0, -10], [0, -22], [10, -22], [10, 0],
];

function trackWith(
  centerline: [number, number][],
  elevation: number[],
  barriers: BarrierSegment[],
): TrackDataV2 {
  return {
    ...fixture,
    centerline,
    lengthMeters: 100,
    elevation,
    kerbs: [],
    runoffs: [],
    barriers,
    terrain: flatTerrain(),
  };
}

function quadStrip(surface: Surface, x0: number, x1: number): SurfaceStrip {
  return {
    surface,
    positions: new Float32Array([x0, 1, -5, x1, 1, -5, x1, 1, 5, x0, 1, 5]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    uvs: new Float32Array(8),
  };
}

function castDown(world: World, x: number, z: number): { collider: RAPIER.Collider; y: number } | null {
  const hit = world.castRay(new RAPIER.Ray({ x, y: 50, z }, { x: 0, y: -1, z: 0 }), 200, true);
  return hit === null ? null : { collider: hit.collider, y: 50 - hit.timeOfImpact };
}

function castX(world: World, fromX: number, y: number, z: number, dir: 1 | -1): { collider: RAPIER.Collider; x: number } | null {
  const hit = world.castRay(new RAPIER.Ray({ x: fromX, y, z }, { x: dir, y: 0, z: 0 }), 100, true);
  return hit === null ? null : { collider: hit.collider, x: fromX + dir * hit.timeOfImpact };
}

function countColliders(world: World): number {
  let count = 0;
  world.forEachCollider(() => count++);
  return count;
}

describe('032 track colliders post-code gaps', () => {
  let worlds: World[] = [];

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds = [];
  });

  it('POST1: addTrackColliders removes only the exact Phase 0 ground cuboid', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(-300, -0.5, -300),
    );
    world.createCollider(RAPIER.ColliderDesc.ball(0.5).setTranslation(-300, 0.5, 100));
    addTrackColliders(world, trackWith(RECT, RECT.map(() => 0), []), []);
    world.step();
    expect(countColliders(world), 'lookalike + ball + terrain, ground removed').toBe(3);
    expect(castDown(world, 400, 400), 'no ground beyond the terrain').toBeNull();
    const box = castDown(world, -300, -300);
    expect(box, 'lookalike cuboid preserved').not.toBeNull();
    expect(box!.y).toBeCloseTo(0, 1);
    expect(surfaceOf(box!.collider)).toBeNull();
    const ball = castDown(world, -300, 100);
    expect(ball, 'ball collider (no half extents) preserved').not.toBeNull();
    expect(ball!.y).toBeCloseTo(1, 1);
  });

  it('POST2: a degenerate centerline spike uses the fallback normal (0,-1) for barrier placement', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    addTrackColliders(
      world,
      trackWith(SPIKE, SPIKE.map(() => 0), [
        { start: 2, end: 3, side: 'right', type: 'wall', offsetMeters: 5 },
      ]),
      [],
    );
    world.step();
    // Spike vertex = P2 + 5*(0,-1) = (0,-25); next vertex (5,-10); the quad
    // crosses z = -24.5 at x = 5 * 0.5/15 = 1/6.
    const hit = castX(world, 10, 0.5, -24.5, -1);
    expect(hit, 'wall quad across the degenerate point').not.toBeNull();
    expect(hit!.x).toBeCloseTo(1 / 6, 1);
    expect(surfaceOf(hit!.collider)).toBeNull();
  });

  it('POST3: missing elevation entries default to 0 for wall heights', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    addTrackColliders(
      world,
      trackWith(RECT, [], [{ start: 1, end: 2, side: 'right', type: 'wall', offsetMeters: 8 }]),
      [],
    );
    world.step();
    const mid = castX(world, 0, 0.5, -15, 1);
    expect(mid).not.toBeNull();
    expect(mid!.x).toBeCloseTo(8, 1);
    expect(surfaceOf(mid!.collider)).toBeNull();
    expect(castX(world, 0, -0.1, -15, 1), 'wall reaches down to -0.3').not.toBeNull();
    expect(castX(world, 0, 1.5, -15, 1), 'nothing above the wall top 1.0').toBeNull();
  });

  it('POST4: the barrier trimesh is created only when at least one wall quad exists', () => {
    const zeros = RECT.map(() => 0);
    const noBarriers = createPhysicsWorld();
    worlds.push(noBarriers);
    addTrackColliders(noBarriers, trackWith(RECT, zeros, []), []);
    noBarriers.step();
    expect(countColliders(noBarriers), 'terrain only').toBe(1);

    const zeroLength = createPhysicsWorld();
    worlds.push(zeroLength);
    addTrackColliders(
      zeroLength,
      trackWith(RECT, zeros, [{ start: 1, end: 1, side: 'right', type: 'wall', offsetMeters: 8 }]),
      [],
    );
    zeroLength.step();
    expect(countColliders(zeroLength), 'start === end builds no quad').toBe(1);

    const full = createPhysicsWorld();
    worlds.push(full);
    addTrackColliders(
      full,
      trackWith(RECT, zeros, [{ start: 1, end: 2, side: 'right', type: 'wall', offsetMeters: 8 }]),
      [quadStrip('gravel', 60, 70), quadStrip('kerb', 80, 90)],
    );
    full.step();
    expect(countColliders(full), 'terrain + 2 strips + 1 barrier trimesh').toBe(4);
    const wall = castX(full, 0, 0.5, -15, 1);
    expect(wall).not.toBeNull();
    expect(wall!.x).toBeCloseTo(8, 1);
  });
});

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import type { Surface, SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

// Task 032 target signature: createPhysicsWorld(track?). The cast keeps this file
// typechecking before and after physicsWorld.ts accepts the optional track.
const createWorld = createPhysicsWorld as (track?: TrackDataV2) => World;

// Closed rectangular centerline, 90 points, 2 m spacing, index 0 in the middle
// of the west straight (x = 0, z = -30, heading -Z, right normal +X) so that
// segments wrapping past index 89 stay on a straight: idx 0..15 west (z -30..-60),
// 16..30 south (z = -60), 31..60 east (x = 30), 61..75 north (z = 0, incl. corner),
// 76..89 west again (z -2..-28).
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 15; i++) CENTERLINE.push([0, -30 - 2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -60]);
for (let i = 1; i <= 30; i++) CENTERLINE.push([30, -60 + 2 * i]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([30 - 2 * i, 0]);
CENTERLINE.push([0, 0]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([0, -2 * i]);

// Rapier heightfield layout (phase1.md): heights.length = (rows+1)*(cols+1),
// column-major (index = col*(rows+1) + row), row <-> z, col <-> x, centred on
// the collider translation; heights are absolute world y.
function makeTerrain(
  heightAt: (x: number, z: number) => number,
  rows = 20,
  cols = 20,
  originX = 0,
  originZ = -30,
  sizeX = 200,
  sizeZ = 200,
): Terrain {
  const heights: number[] = [];
  for (let c = 0; c <= cols; c++) {
    const x = originX - sizeX / 2 + (c * sizeX) / cols;
    for (let r = 0; r <= rows; r++) {
      heights.push(heightAt(x, originZ - sizeZ / 2 + (r * sizeZ) / rows));
    }
  }
  return { originX, originZ, sizeX, sizeZ, rows, cols, heights };
}

function rectTrack(o: Partial<TrackDataV2> = {}): TrackDataV2 {
  return {
    ...fixture,
    centerline: CENTERLINE,
    lengthMeters: 180,
    elevation: CENTERLINE.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: makeTerrain(() => 0),
    ...o,
  };
}

// Horizontal quad, CCW seen from +Y, spanning x0..x1, z -10..0 at height y.
function quadStrip(surface: Surface, x0: number, x1: number, y: number): SurfaceStrip {
  return {
    surface,
    positions: new Float32Array([x0, y, -10, x1, y, -10, x1, y, 0, x0, y, 0]),
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

describe('032 track colliders edge cases', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: surfaceOf is null for the Phase 0 ground and for unregistered colliders', () => {
    world = createPhysicsWorld();
    world.step();
    const manual = world.createCollider(
      RAPIER.ColliderDesc.cuboid(1, 1, 1).setTranslation(30, 1, 30),
    );
    expect(surfaceOf(manual)).toBeNull();
    const hit = castDown(world, 3, 3);
    expect(hit).not.toBeNull();
    expect(surfaceOf(hit!.collider)).toBeNull();
  });

  it('EDGE2: createPhysicsWorld(track) does not create the flat Phase 0 ground', () => {
    world = createWorld(rectTrack());
    world.step();
    expect(castDown(world, 0, -35), 'track surface must be there').not.toBeNull();
    expect(castDown(world, 400, 400), 'no ground beyond the terrain').toBeNull();
  });

  it('EDGE3: the terrain heightfield is translated to (originX, 0, originZ) and maps to grass', () => {
    const terrain = makeTerrain(() => 4, 4, 4, 60, -50, 100, 60);
    world = createPhysicsWorld();
    addTrackColliders(world, rectTrack({ terrain }), []);
    world.step();
    const centre = castDown(world, 60, -50);
    expect(centre).not.toBeNull();
    expect(centre!.y).toBeCloseTo(4, 1);
    expect(surfaceOf(centre!.collider)).toBe('grass');
    const corner = castDown(world, 105, -25);
    expect(corner).not.toBeNull();
    expect(corner!.y).toBeCloseTo(4, 1);
    expect(surfaceOf(corner!.collider)).toBe('grass');
    expect(castDown(world, 5, -50), 'outside the translated extent').toBeNull();
  });

  it('EDGE4: a non-square heightfield grid maps rows to z and cols to x', () => {
    const terrain = makeTerrain((x) => 0.1 * x, 4, 2, 0, 0, 200, 200);
    world = createPhysicsWorld();
    addTrackColliders(world, rectTrack({ terrain }), []);
    world.step();
    const a = castDown(world, 15, -30);
    const b = castDown(world, 15, 40);
    const c = castDown(world, -15, 40);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(a!.y).toBeCloseTo(1.5, 1);
    expect(b!.y, 'same x, different z, same height').toBeCloseTo(1.5, 1);
    expect(c!.y).toBeCloseTo(-1.5, 1);
    expect(surfaceOf(a!.collider)).toBe('grass');
  });

  it('EDGE5: barrier walls span elevation-0.3..elevation+1.0 at the exact offset plane, surfaceOf null', () => {
    const elevation = CENTERLINE.map((_, i) => (i <= 8 ? 2 : 0));
    world = createWorld(
      rectTrack({
        elevation,
        barriers: [{ start: 2, end: 6, side: 'right', type: 'wall', offsetMeters: 11 }],
      }),
    );
    world.step();
    const mid = castX(world, 0, 2.5, -38, 1);
    expect(mid, 'wall reaches elevation+1.0 = 3.0').not.toBeNull();
    expect(mid!.x).toBeCloseTo(11, 1);
    expect(surfaceOf(mid!.collider)).toBeNull();
    const low = castX(world, 0, 1.85, -38, 1);
    expect(low, 'wall reaches below the track (elevation-0.3 = 1.7)').not.toBeNull();
    expect(low!.x).toBeCloseTo(11, 1);
    expect(castX(world, 0, 3.5, -38, 1), 'nothing above elevation+1.0').toBeNull();
  });

  it('EDGE6: a left-side barrier wall sits at minus offset along the right normal', () => {
    world = createWorld(
      rectTrack({
        barriers: [{ start: 2, end: 6, side: 'left', type: 'armco', offsetMeters: 9 }],
      }),
    );
    world.step();
    const hit = castX(world, 0, 0.5, -38, -1);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(-9, 1);
    expect(surfaceOf(hit!.collider)).toBeNull();
    expect(castX(world, 0, 0.5, -38, 1), 'no wall on the right side').toBeNull();
  });

  it('EDGE7: a barrier segment wrapping past the last index builds wall across the wrap', () => {
    world = createWorld(
      rectTrack({
        barriers: [{ start: 86, end: 4, side: 'right', type: 'wall', offsetMeters: 11 }],
      }),
    );
    world.step();
    const hit = castX(world, 0, 0.5, -31, 1);
    expect(hit, 'wall across index 89 -> 0').not.toBeNull();
    expect(hit!.x).toBeCloseTo(11, 1);
    expect(surfaceOf(hit!.collider)).toBeNull();
  });

  it('EDGE8: all barrier segments share a single trimesh collider', () => {
    world = createWorld(
      rectTrack({
        barriers: [
          { start: 2, end: 4, side: 'right', type: 'wall', offsetMeters: 11 },
          { start: 8, end: 12, side: 'right', type: 'armco', offsetMeters: 11 },
        ],
      }),
    );
    world.step();
    const a = castX(world, 0, 0.5, -35, 1);
    const b = castX(world, 0, 0.5, -47, 1);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.collider.handle).toBe(b!.collider.handle);
    expect(surfaceOf(a!.collider)).toBeNull();
  });

  it('EDGE9: addTrackColliders clears the handle map at the start of every call', () => {
    world = createPhysicsWorld();
    addTrackColliders(world, rectTrack(), [quadStrip('gravel', 10, 20, 1)]);
    world.step();
    const first = castDown(world, 15, -5);
    expect(first).not.toBeNull();
    expect(surfaceOf(first!.collider)).toBe('gravel');
    addTrackColliders(world, rectTrack(), [quadStrip('kerb', 30, 40, 1)]);
    world.step();
    const stale = castDown(world, 15, -5);
    expect(stale, 'the old trimesh is still physical').not.toBeNull();
    expect(surfaceOf(stale!.collider), 'but no longer registered').toBeNull();
    const fresh = castDown(world, 35, -5);
    expect(fresh).not.toBeNull();
    expect(surfaceOf(fresh!.collider)).toBe('kerb');
  });

  it('EDGE10: two consecutive worlds free cleanly and the second maps fresh surfaces', () => {
    const w1 = createWorld(
      rectTrack({ runoffs: [{ start: 2, end: 8, side: 'right', surface: 'gravel', widthMeters: 4 }] }),
    );
    w1.step();
    const gravel = castDown(w1, 8, -35);
    expect(gravel).not.toBeNull();
    expect(surfaceOf(gravel!.collider)).toBe('gravel');
    w1.free();
    world = createWorld(
      rectTrack({ kerbs: [{ start: 2, end: 8, side: 'right' }] }),
    );
    world.step();
    const kerb = castDown(world, 6.6, -35);
    expect(kerb).not.toBeNull();
    expect(surfaceOf(kerb!.collider), 'no stale surface from the freed world').toBe('kerb');
    const asphalt = castDown(world, 0, -35);
    expect(asphalt).not.toBeNull();
    expect(surfaceOf(asphalt!.collider)).toBe('asphalt');
  });
});

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type {
  BarrierSegment,
  DriverInput,
  RunoffSegment,
  Terrain,
  TrackDataV2,
  TrackSegment,
} from '../../../src/core/types';
import { fixture } from './022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

// Task 032 target signature: createPhysicsWorld(track?). The cast keeps this file
// typechecking before and after physicsWorld.ts accepts the optional track.
const createWorld = createPhysicsWorld as (track?: TrackDataV2) => World;

// Closed rectangular centerline, 92 points, 2 m spacing. Indices 0..30 are the
// test straight (x = 0, z = 0..-60, heading -Z so the right normal is +X);
// indices 31..45 bottom (z = -60), 46..76 east side (x = 30), 77..91 top (z = 2).
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 30; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -60]);
for (let i = 1; i <= 31; i++) CENTERLINE.push([30, -60 + 2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([30 - 2 * i, 2]);

const ORIGIN_X = 0;
const ORIGIN_Z = -30;
const SIZE_X = 200;
const SIZE_Z = 200;
const CELLS = 20;

// Rapier heightfield layout: heights.length = (rows+1)*(cols+1), column-major
// (index = col*(rows+1) + row), centred on the collider translation
// (originX, 0, originZ); heights are absolute world y.
function makeTerrain(heightAt: (x: number) => number): Terrain {
  const heights: number[] = [];
  for (let col = 0; col <= CELLS; col++) {
    const x = ORIGIN_X - SIZE_X / 2 + (col * SIZE_X) / CELLS;
    const h = heightAt(x);
    for (let row = 0; row <= CELLS; row++) heights.push(h);
  }
  return {
    originX: ORIGIN_X,
    originZ: ORIGIN_Z,
    sizeX: SIZE_X,
    sizeZ: SIZE_Z,
    rows: CELLS,
    cols: CELLS,
    heights,
  };
}

function rectTrack(
  terrain: Terrain,
  elevation: number[],
  kerbs: TrackSegment[],
  runoffs: RunoffSegment[],
  barriers: BarrierSegment[],
): TrackDataV2 {
  return { ...fixture, centerline: CENTERLINE, lengthMeters: 184, elevation, kerbs, runoffs, barriers, terrain };
}

// Fixture A (AT2/AT3): terrain slopes +0.1 m per m along x; the straight climbs
// to 1.5 m (elevation[0] = 0, ramp 0..10, flat 10..30, ramp down 30..40).
const ELEVATION_A = CENTERLINE.map((_, i) =>
  i <= 10 ? 0.15 * i : i <= 30 ? 1.5 : i <= 40 ? 1.5 - 0.15 * (i - 30) : 0,
);
const trackSloped = rectTrack(makeTerrain((x) => 0.1 * x), ELEVATION_A, [], [], []);

// Fixture B (AT4/AT5): flat terrain at y = 0, gravel runoff on the right of the
// straight (x = 6..10, y = 0.01) and a right barrier at 11 m
// (wall plane x = 11, z = -4..-56, y = -0.3..1.0).
const trackFlat = rectTrack(
  makeTerrain(() => 0),
  CENTERLINE.map(() => 0),
  [],
  [{ start: 0, end: 30, side: 'right', surface: 'gravel', widthMeters: 4 }],
  [{ start: 2, end: 28, side: 'right', type: 'wall', offsetMeters: 11 }],
);

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

// Downward raycast; probe points avoid strip quad edges/diagonals and terrain grid lines.
function castDown(world: World, x: number, z: number): { collider: RAPIER.Collider; y: number } | null {
  const fromY = 50;
  const hit = world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), 200, true);
  return hit === null ? null : { collider: hit.collider, y: fromY - hit.timeOfImpact };
}

describe('032 physics track colliders acceptance', () => {
  let world: World | null = null;
  let car: Vehicle | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    car = null;
    world?.free();
    world = null;
  });

  it('AT1: createPhysicsWorld() without track keeps the Phase 0 ground: a 1 m cube rests at y 0.5', () => {
    world = createPhysicsWorld();
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    for (let i = 0; i < 360; i++) world.step();
    expect(Math.abs(body.translation().y - 0.5)).toBeLessThanOrEqual(0.05);
  }, 20000);

  it('AT2: downward raycast over terrain sloped 0.1 m/m along x hits height 0.1*x', () => {
    world = createWorld(trackSloped);
    world.step();
    for (const x of [-39, -19, 21, 41]) {
      const hit = castDown(world, x, -29);
      expect(hit, `terrain hit at x=${x}`).not.toBeNull();
      expect(Math.abs(hit!.y - 0.1 * x), `terrain height at x=${x}`).toBeLessThanOrEqual(0.05);
    }
  });

  it('AT3: raycast at a centerline point hits asphalt with surfaceOf asphalt at elevation + 0.02', () => {
    world = createWorld(trackSloped);
    world.step();
    for (const z of [-29.5, -33.5, -47.5]) {
      const hit = castDown(world, 0, z);
      expect(hit, `hit at z=${z}`).not.toBeNull();
      expect(surfaceOf(hit!.collider), `surface at z=${z}`).toBe('asphalt');
      const elevation = ELEVATION_A[Math.round(-z / 2)];
      expect(Math.abs(hit!.y - (elevation + 0.02)), `asphalt height at z=${z}`).toBeLessThanOrEqual(0.02);
    }
  });

  it('AT4: raycast inside the gravel runoff maps to surface gravel', () => {
    world = createWorld(trackFlat);
    world.step();
    for (const [x, z] of [[8, -29.5], [7.5, -45.5], [9, -15.5]]) {
      const hit = castDown(world, x, z);
      expect(hit, `hit at (${x},${z})`).not.toBeNull();
      expect(surfaceOf(hit!.collider), `surface at (${x},${z})`).toBe('gravel');
    }
  });

  it('AT5: car body driven sideways at 10 m/s toward the barrier at x = 11 stops before crossing it', () => {
    world = createWorld(trackFlat);
    car = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: -30 }, yaw: 0 });
    // Settle on the asphalt, then drive sideways (+x, toward the right barrier) at 10 m/s.
    for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      world.step();
    }
    let maxX = car.body.translation().x;
    let pushing = true;
    for (let i = 0; i < Math.round(4 / FIXED_DT); i++) {
      if (i >= Math.round(2 / FIXED_DT) || car.body.translation().x > 8.0) pushing = false;
      if (pushing) {
        const lv = car.body.linvel();
        car.body.setLinvel({ x: 10, y: lv.y, z: lv.z }, true);
      }
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      world.step();
      const t = car.body.translation();
      maxX = Math.max(maxX, t.x);
      expect(t.x, 'car centre must not cross the barrier line').toBeLessThan(11);
      expect(t.y, 'car must stay on the ground').toBeGreaterThan(-0.5);
      expect(t.y).toBeLessThan(2);
    }
    // It really reached the barrier (contact near x = 11 - half chassis width), not stopped early.
    expect(maxX).toBeGreaterThan(8.5);
    expect(car.body.translation().x).toBeLessThan(11);
  }, 20000);
});

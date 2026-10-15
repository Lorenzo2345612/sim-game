import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { addTrackColliders } from '../../../src/physics/trackColliders';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';
import { rollingDrag } from '../../../src/physics/surfaceDrag';
import type { DriverInput, Surface, SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

type World = ReturnType<typeof createPhysicsWorld>;
// Task 033 target signature; the intersection keeps this file typechecking before Vehicle has it.
type VehicleWithSurfaces = Vehicle & { getWheelSurfaces(): Surface[] };

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

// Flat grass terrain; surface zones are hand-built quads so the boundaries are exact.
// Quads are wound CCW seen from +Y (phase1.md: vehicle down rays hit those faces).
const CELLS = 40;
const terrain: Terrain = {
  originX: 0,
  originZ: -25,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: Array.from({ length: (CELLS + 1) * (CELLS + 1) }, () => 0),
};

const track: TrackDataV2 = {
  ...fixture,
  centerline: [
    [0, 0],
    [0, -2],
    [0, -4],
  ],
  lengthMeters: 4,
  elevation: [0, 0, 0],
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain,
};

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function rect(surface: Surface, x0: number, x1: number, zMin: number, zMax: number, y = 0.02): SurfaceStrip {
  return {
    surface,
    positions: new Float32Array([x0, y, zMin, x1, y, zMin, x1, y, zMax, x0, y, zMax]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    uvs: new Float32Array(8),
  };
}

// Coast zone along z -60..2: asphalt x -6..6, gravel 6..14, runoff 14..22; grass elsewhere.
const zoneStrips: SurfaceStrip[] = [
  rect('asphalt', -6, 6, -60, 2),
  rect('gravel', 6, 14, -60, 2),
  rect('runoff', 14, 22, -60, 2),
];

function zoneWorld(): World {
  const w = createPhysicsWorld();
  addTrackColliders(w, track, zoneStrips);
  return w;
}

function run(w: World, car: Vehicle, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
}

function settle(w: World, x: number, z: number): Vehicle {
  const car = new Vehicle(w, SPEC, { position: { x, y: 0.6, z }, yaw: 0 });
  run(w, car, 1.5);
  return car;
}

function launch(car: Vehicle, vz: number): void {
  car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: vz }, true);
}

function horizSpeed(car: Vehicle): number {
  const v = car.body.linvel();
  return Math.hypot(v.x, v.z);
}

function surfacesOf(car: Vehicle): Surface[] {
  return (car as VehicleWithSurfaces).getWheelSurfaces();
}

describe('033 surface grip edge cases', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: getWheelSurfaces returns all asphalt in the Phase 0 world (no track)', () => {
    // Runs first: the module-level handle map must still be empty of track surfaces.
    world = createPhysicsWorld();
    const car = settle(world, 0, 0);
    expect(surfacesOf(car)).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 20000);

  it('EDGE2: getWheelSurfaces reuses one preallocated array and refreshes it on every call', () => {
    world = zoneWorld();
    const car = settle(world, -20, -10); // grass terrain, outside the asphalt zone
    const first = surfacesOf(car);
    expect(first).toEqual(['grass', 'grass', 'grass', 'grass']);
    expect(surfacesOf(car)).toBe(first);
    car.body.setTranslation({ x: 0, y: 0.6, z: -10 }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    run(world, car, 0.5);
    const after = surfacesOf(car);
    expect(after).toBe(first);
    expect(after).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 20000);

  it('EDGE3: wheels with no ground object read asphalt (fresh car and in the air over gravel)', () => {
    world = zoneWorld();
    const fresh = new Vehicle(world, SPEC, { position: { x: 10, y: 0.6, z: -20 }, yaw: 0 });
    expect(surfacesOf(fresh)).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
    const falling = new Vehicle(world, SPEC, { position: { x: 10, y: 5, z: -10 }, yaw: 0 });
    run(world, falling, 0.1);
    for (const wheel of falling.getState().wheels) {
      expect(wheel.inContact).toBe(false);
    }
    expect(surfacesOf(falling)).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 20000);

  it('EDGE4: wheels over different surfaces map per wheel in FL FR RL RR order, all five surfaces', () => {
    world = createPhysicsWorld();
    addTrackColliders(world, track, [
      rect('kerb', -1.3, -0.3, -1.8, -0.8),
      rect('runoff', 0.3, 1.3, -1.8, -0.8),
      rect('gravel', -1.3, -0.3, 0.7, 1.7),
      rect('asphalt', 0.3, 1.3, 0.7, 1.7),
    ]);
    const car = settle(world, 0, 0);
    expect(surfacesOf(car)).toEqual(['kerb', 'runoff', 'gravel', 'asphalt']);
  }, 20000);

  it('EDGE5: gravel drag stops a car launched at 1 m/s without ever reversing the velocity', () => {
    world = zoneWorld();
    const car = settle(world, 10, -10);
    expect(surfacesOf(car)).toEqual(['gravel', 'gravel', 'gravel', 'gravel']);
    launch(car, -1);
    let maxVz = -Infinity;
    const steps = Math.round(0.5 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      world.step();
      maxVz = Math.max(maxVz, car.body.linvel().z);
    }
    expect(horizSpeed(car)).toBeLessThan(0.6);
    run(world, car, 1.5);
    for (let i = 0; i < 10; i++) {
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      world.step();
      maxVz = Math.max(maxVz, car.body.linvel().z);
    }
    expect(maxVz, 'drag never reverses the velocity').toBeLessThanOrEqual(0.001);
    expect(horizSpeed(car)).toBeLessThanOrEqual(0.05);
  }, 20000);

  it('EDGE6: gravel coasting loss equals the rollingDrag deceleration at the launch speed over 4 wheels', () => {
    world = zoneWorld();
    const asphalt = settle(world, 0, -8);
    launch(asphalt, -30);
    run(world, asphalt, 1);
    const vA = horizSpeed(asphalt);
    const gravel = settle(world, 10, -8);
    launch(gravel, -30);
    run(world, gravel, 1);
    const vG = horizSpeed(gravel);
    const m = SPEC.chassis.massKg + SPEC.fuel.startL * SPEC.fuel.densityKgL;
    const fz = (m * Math.abs(GRAVITY)) / 4; // per-wheel static load
    const expectedAt = (v: number): number => (rollingDrag('gravel', v, fz) / (m / 4)) * 1;
    const loss = vA - vG;
    // Drag is speed-dependent; the true loss lies between the end-speed and launch-speed values.
    expect(loss).toBeGreaterThanOrEqual(expectedAt(vG) - 0.45);
    expect(loss).toBeLessThanOrEqual(expectedAt(30) + 0.2);
  }, 20000);

  it('EDGE7: zero-drag surfaces (runoff) do not slow the car versus asphalt', () => {
    world = zoneWorld();
    const asphalt = settle(world, 0, -8);
    launch(asphalt, -30);
    run(world, asphalt, 1);
    const vA = horizSpeed(asphalt);
    const runoff = settle(world, 18, -8);
    expect(surfacesOf(runoff)).toEqual(['runoff', 'runoff', 'runoff', 'runoff']);
    launch(runoff, -30);
    run(world, runoff, 1);
    const vR = horizSpeed(runoff);
    expect(vR).toBeGreaterThanOrEqual(vA - 1);
    expect(vR).toBeLessThanOrEqual(vA + 0.01);
  }, 20000);

  it('EDGE9: prePhysicsStep with dt 0, NaN or negative applies no drag impulse and keeps the body finite', () => {
    world = zoneWorld();
    const car = settle(world, 10, -10);
    launch(car, -5);
    for (const dt of [0, Number.NaN, -1 / 120]) {
      const before = car.body.linvel();
      car.prePhysicsStep(dt);
      const v = car.body.linvel();
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      expect(v.x).toBe(before.x);
      expect(v.y).toBe(before.y);
      expect(v.z).toBe(before.z);
    }
    run(world, car, 0.25);
    expect(surfacesOf(car)).toEqual(['gravel', 'gravel', 'gravel', 'gravel']);
  }, 20000);
});

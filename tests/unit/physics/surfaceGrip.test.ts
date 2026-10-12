import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT, SURFACE_GRIP } from '../../../src/core/constants';
import type { DriverInput, Terrain, TrackDataV2 } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

// Closed rectangle, 2 m spacing; straight indices 0..40 along -Z, gravel runoff on the
// right (x = 6..14) over flat terrain.
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 40; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 10; i++) CENTERLINE.push([2 * i, -80]);
for (let i = 1; i <= 40; i++) CENTERLINE.push([20, -80 + 2 * i]);
for (let i = 1; i <= 9; i++) CENTERLINE.push([20 - 2 * i, 0]);

const CELLS = 40;
const terrain: Terrain = {
  originX: 0,
  originZ: -40,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: Array.from({ length: (CELLS + 1) * (CELLS + 1) }, () => 0),
};

const track: TrackDataV2 = {
  version: 2,
  id: 'surface-grip-edge',
  name: 'Edge',
  widthMeters: 12,
  lengthMeters: 180,
  officialLengthMeters: 180,
  centerline: CENTERLINE,
  sectors: [0, 10, 20],
  elevation: CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [{ start: 0, end: 40, side: 'right', surface: 'gravel', widthMeters: 8 }],
  barriers: [],
  terrain,
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 0, end: 0, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com', dem: 'test.tif' },
};

function settle(w: World, x: number, z: number): Vehicle {
  const car = new Vehicle(w, PLACEHOLDER_CAR, { position: { x, y: 0.6, z }, yaw: 0 });
  for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
  return car;
}

function controllerOf(car: Vehicle): RAPIER.DynamicRayCastVehicleController {
  return (car as unknown as { controller: RAPIER.DynamicRayCastVehicleController }).controller;
}

describe('surface grip and drag', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  // Phase 0 tests first: track colliders leave their handles in a module-level map
  // that a later fresh world can collide with.
  it('getWheelSurfaces returns all asphalt in the Phase 0 world', () => {
    world = createPhysicsWorld();
    const car = settle(world, 0, 0);
    expect(car.getWheelSurfaces()).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 20000);

  it('getWheelSurfaces returns the same preallocated array every call', () => {
    world = createPhysicsWorld();
    const car = settle(world, 0, 0);
    expect(car.getWheelSurfaces()).toBe(car.getWheelSurfaces());
  }, 20000);

  it('leaves frictionSlip untouched on asphalt', () => {
    world = createPhysicsWorld();
    const car = settle(world, 0, 0);
    car.prePhysicsStep(FIXED_DT);
    const c = controllerOf(car);
    for (let i = 0; i < 4; i++) {
      expect(c.wheelFrictionSlip(i)).toBeCloseTo(PLACEHOLDER_CAR.frictionSlip, 5);
    }
  }, 20000);

  it('coasting from 1 m/s on gravel never reverses the velocity', () => {
    world = createPhysicsWorld(track);
    const car = settle(world, 10, -10);
    expect(car.getWheelSurfaces()).toEqual(['gravel', 'gravel', 'gravel', 'gravel']);
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -1 }, true);
    for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      world.step();
      const v = car.body.linvel();
      expect(v.z).toBeLessThanOrEqual(0.01);
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1.01);
    }
  }, 20000);

  it('scales frictionSlip by SURFACE_GRIP on grass', () => {
    world = createPhysicsWorld(track);
    const car = settle(world, -20, -10);
    car.prePhysicsStep(FIXED_DT);
    expect(car.getWheelSurfaces()).toEqual(['grass', 'grass', 'grass', 'grass']);
    const c = controllerOf(car);
    for (let i = 0; i < 4; i++) {
      expect(c.wheelFrictionSlip(i)).toBeCloseTo(
        PLACEHOLDER_CAR.frictionSlip * SURFACE_GRIP.grass,
        5,
      );
    }
  }, 20000);
});

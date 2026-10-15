import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Surface, Terrain, TrackDataV2 } from '../../../src/core/types';
import { fixture } from './022-fixture-trackdatav2';

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

// Closed rectangular fixture, 2 m spacing. Straight indices 0..75 (x = 0, z = 0..-150,
// heading -Z so the right normal is +X): asphalt strip x = -6..6 (widthMeters 12) over
// flat grass terrain (y = 0), gravel runoff on the right (x = 6..14, y = 0.01).
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 75; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -150]);
for (let i = 1; i <= 75; i++) CENTERLINE.push([30, -150 + 2 * i]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([30 - 2 * i, 0]);

const CELLS = 40;
const terrain: Terrain = {
  originX: 0,
  originZ: -75,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: Array.from({ length: (CELLS + 1) * (CELLS + 1) }, () => 0),
};

const track: TrackDataV2 = {
  ...fixture,
  centerline: CENTERLINE,
  lengthMeters: 360,
  elevation: CENTERLINE.map(() => 0),
  kerbs: [],
  runoffs: [{ start: 0, end: 75, side: 'right', surface: 'gravel', widthMeters: 8 }],
  barriers: [],
  terrain,
};

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function settle(w: World, x: number, z: number): Vehicle {
  const car = new Vehicle(w, SPEC, { position: { x, y: 0.6, z }, yaw: 0 });
  for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
  return car;
}

// Settle at (x, z), launch along -Z at 30 m/s, coast 2 s; return the horizontal speed.
function coastOn(w: World, x: number, z: number): number {
  const car = settle(w, x, z);
  car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -30 }, true);
  for (let i = 0; i < Math.round(2 / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
  const v = car.body.linvel();
  return Math.hypot(v.x, v.z);
}

// Settle at (x, z), full throttle 3 s from rest; return the horizontal distance covered.
function throttleDistance(w: World, x: number, z: number): number {
  const car = settle(w, x, z);
  const p0 = car.body.translation();
  const startX = p0.x;
  const startZ = p0.z;
  for (let i = 0; i < Math.round(3 / FIXED_DT); i++) {
    car.setInput(FULL);
    car.prePhysicsStep(FIXED_DT);
    w.step();
  }
  const p1 = car.body.translation();
  return Math.hypot(p1.x - startX, p1.z - startZ);
}

describe('033 surface grip acceptance', () => {
  let world: World | null = null;
  let vA = 0; // AT1 reference speed, consumed by AT2/AT3 (same-file declaration order)

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: coasting 2 s at 30 m/s on asphalt gives the reference speed v_a', () => {
    world = createPhysicsWorld(track);
    vA = coastOn(world, 0, -10);
    expect(vA).toBeGreaterThan(0);
    expect(vA).toBeLessThan(30);
  }, 20000);

  it('AT2: coasting 2 s at 30 m/s on grass loses at least 2 m/s more than on asphalt', () => {
    world = createPhysicsWorld(track);
    const grassSpeed = coastOn(world, -20, -10);
    expect(grassSpeed).toBeLessThanOrEqual(vA - 2);
  }, 20000);

  it('AT3: coasting 2 s at 30 m/s on gravel loses at least 8 m/s more than on asphalt', () => {
    world = createPhysicsWorld(track);
    const gravelSpeed = coastOn(world, 9, -10);
    expect(gravelSpeed).toBeLessThanOrEqual(vA - 8);
  }, 20000);

  it('AT4: left wheels off the asphalt read [grass, asphalt, grass, asphalt]', () => {
    world = createPhysicsWorld(track);
    const car = settle(world, -6, -30);
    const surfaces: Surface[] = (car as VehicleWithSurfaces).getWheelSurfaces();
    expect(surfaces).toEqual(['grass', 'asphalt', 'grass', 'asphalt']);
  }, 20000);

  it('AT5: 3 s full throttle from rest on grass covers less than 85 % of the asphalt distance', () => {
    world = createPhysicsWorld(track);
    const asphaltDistance = throttleDistance(world, 0, -10);
    world.free();
    world = createPhysicsWorld(track);
    const grassDistance = throttleDistance(world, -20, -10);
    expect(grassDistance).toBeLessThan(0.85 * asphaltDistance);
  }, 20000);
});

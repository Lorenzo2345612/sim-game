import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { Vehicle, type Telemetry } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT, GRAVITY, MS_TO_KMH } from '../../../src/core/constants';
import type {
  DriverInput,
  Quat,
  SpawnPose,
  VehicleState,
} from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();
const STATIC_Y = SPEC.chassis.cgHeight;
const SLOPE = Math.atan(0.05);
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function step(vehicle: Vehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(vehicle: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) step(vehicle, world, inp);
}

function isFiniteState(s: VehicleState): boolean {
  const n = [
    s.position.x,
    s.position.y,
    s.position.z,
    s.rotation.x,
    s.rotation.y,
    s.rotation.z,
    s.rotation.w,
    s.forwardSpeed,
  ];
  if (!n.every((v) => Number.isFinite(v))) return false;
  return s.wheels.every((w) =>
    [w.position.x, w.position.y, w.position.z, w.rotation, w.steering].every((v) =>
      Number.isFinite(v),
    ),
  );
}

function upY(q: Quat): number {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

function displacement(a: VehicleState, b: VehicleState): number {
  return Math.hypot(
    b.position.x - a.position.x,
    b.position.y - a.position.y,
    b.position.z - a.position.z,
  );
}

// Ground plane through the world origin, normal tilted by SLOPE about +X (uphill along -Z).
function createSlopeWorld(): World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = FIXED_DT;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000)
      .setTranslation(0, -0.5 * Math.cos(SLOPE), -0.5 * Math.sin(SLOPE))
      .setRotation({ x: Math.sin(SLOPE / 2), y: 0, z: 0, w: Math.cos(SLOPE / 2) }),
  );
  return world;
}

describe('065 vehicle model acceptance', () => {
  let world: World;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world.free();
  });

  it('AT1: ride height within 5 mm of static after 2 s idle from a 0.02 m spawn', () => {
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y + 0.02));
    run(vehicle, world, 2, IDLE);
    const state = vehicle.getState();
    expect(isFiniteState(state)).toBe(true);
    expect(Math.abs(state.position.y - STATIC_Y)).toBeLessThan(0.005);
  }, 30000);

  it('AT2: standstill on flat ground drifts less than 1 cm in 10 s', () => {
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(vehicle, world, 2, IDLE);
    const before = vehicle.getState();
    run(vehicle, world, 10, IDLE);
    const after = vehicle.getState();
    expect(displacement(before, after)).toBeLessThan(0.01);
  }, 30000);

  it('AT3: full brake on a 5% slope drifts less than 5 cm in 10 s', () => {
    world = createSlopeWorld();
    const vehicle = new Vehicle(world, SPEC, {
      position: {
        x: 0,
        y: STATIC_Y * Math.cos(SLOPE),
        z: STATIC_Y * Math.sin(SLOPE),
      },
      yaw: 0,
    });
    // SpawnPose has no pitch: align the chassis with the slope like the lab reference.
    vehicle.body.setRotation(
      { x: Math.sin(SLOPE / 2), y: 0, z: 0, w: Math.cos(SLOPE / 2) },
      true,
    );
    const brake = input(0, 1);
    run(vehicle, world, 2, brake);
    const before = vehicle.getState();
    run(vehicle, world, 10, brake);
    const after = vehicle.getState();
    expect(displacement(before, after)).toBeLessThan(0.05);
  }, 30000);

  it('AT4: drop from 0.5 m settles upright with no NaN in 3 s', () => {
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y + 0.5));
    run(vehicle, world, 3, IDLE);
    const state = vehicle.getState();
    expect(isFiniteState(state)).toBe(true);
    expect(upY(state.rotation)).toBeGreaterThan(0.9);
    expect(Math.abs(state.position.y - STATIC_Y)).toBeLessThan(0.005);
  }, 30000);

  it('AT5: full throttle exceeds 100 km/h in 6 s with finite wheel kappa', () => {
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(vehicle, world, 6, input(1));
    const state = vehicle.getState();
    expect(state.forwardSpeed * MS_TO_KMH).toBeGreaterThan(100);
    const tel: Telemetry = vehicle.getTelemetry();
    expect(tel.wheels.length).toBe(4);
    for (const wheel of tel.wheels) {
      expect(Number.isFinite(wheel.kappa)).toBe(true);
    }
  }, 30000);

  it('AT6: at rest 4 wheels report fz >= 0 summing to (m+fuel)*g within 5%', () => {
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y));
    run(vehicle, world, 2, IDLE);
    const expected =
      (SPEC.chassis.massKg + SPEC.fuel.startL * SPEC.fuel.densityKgL) *
      Math.abs(GRAVITY);
    for (let i = 0; i < 120; i++) {
      step(vehicle, world, IDLE);
      const tel: Telemetry = vehicle.getTelemetry();
      expect(tel.wheels.length).toBe(4);
      let sum = 0;
      for (const wheel of tel.wheels) {
        expect(wheel.fz).toBeGreaterThanOrEqual(0);
        sum += wheel.fz;
      }
      expect(sum).toBeGreaterThanOrEqual(expected * 0.95);
      expect(sum).toBeLessThanOrEqual(expected * 1.05);
    }
  }, 30000);
});

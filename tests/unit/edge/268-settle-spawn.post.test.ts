import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { SpawnPose } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import * as vehicleModel from '../../../src/physics/vehicleModel';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8')),
);
const R = SPEC.wheels.radius;
const IDLE = { throttle: 0, brake: 0, steer: 0, reset: false };
const FILTER = (vehicleModel as unknown as { WHEEL_RAY_FILTER_GROUPS: number }).WHEEL_RAY_FILTER_GROUPS;

type World = ReturnType<typeof createPhysicsWorld>;

function flatWorld(): World {
  const world = createPhysicsWorld();
  world.step();
  return world;
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function yOf(car: vehicleModel.VehicleModel): number {
  return car.body.translation().y;
}

describe('268 settle-spawn post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: a spawn below the ride height is honoured, never lifted by the constructor', () => {
    const world = flatWorld();
    try {
      const car = new vehicleModel.VehicleModel(world, SPEC, spawn(0.1));
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'spawn y untouched').toBeCloseTo(0.1, 6);
    } finally {
      world.free();
    }
  });

  it('POST2: a spawn above the ride height is never lifted or lowered', () => {
    const world = flatWorld();
    try {
      const car = new vehicleModel.VehicleModel(world, SPEC, spawn(0.6));
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'high spawn untouched by the settle').toBeCloseTo(0.6, 6);
    } finally {
      world.free();
    }
  });

  it('POST3: a running car that later drops below the ride height is not teleported', () => {
    const world = flatWorld();
    try {
      const car = new vehicleModel.VehicleModel(world, SPEC, spawn(0.6));
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      car.body.setTranslation({ x: 0, y: 0.2, z: 0 }, true);
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'no mid-run teleport when the ground comes within one radius').toBeCloseTo(0.2, 6);
    } finally {
      world.free();
    }
  });

  it('POST4: reset places the car exactly at the spawn pose without lifting', () => {
    const world = flatWorld();
    try {
      const car = new vehicleModel.VehicleModel(world, SPEC, spawn(0.1));
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'first spawn honoured').toBeCloseTo(0.1, 6);
      car.reset(spawn(0.12));
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'reset spawn honoured').toBeCloseTo(0.12, 6);
    } finally {
      world.free();
    }
  });

  it('POST5: a spawn that sits exactly at the ride height does not move', () => {
    const world = flatWorld();
    try {
      const car = new vehicleModel.VehicleModel(world, SPEC, spawn(R));
      car.setInput(IDLE);
      car.prePhysicsStep(FIXED_DT);
      expect(yOf(car), 'exact ride height unchanged').toBeCloseTo(R, 6);
    } finally {
      world.free();
    }
  });

  it('POST6: the wheel ray filter still hits the ground under the car', () => {
    const world = flatWorld();
    try {
      const hit = world.castRay(
        new RAPIER.Ray({ x: 0, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }),
        5,
        true,
        undefined,
        FILTER,
      );
      expect(hit, 'filtered wheel ray reaches the ground').not.toBeNull();
      expect(hit!.timeOfImpact, 'ground at y = 0').toBeCloseTo(2, 4);
    } finally {
      world.free();
    }
  });
});

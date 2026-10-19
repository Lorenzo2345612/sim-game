import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { SpawnPose } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { VehicleModel } from '../../../src/physics/vehicleModel';
import { BARRIER_GROUP, registerSurface } from '../../../src/physics/trackColliders';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8')),
);
const IDLE = { throttle: 0, brake: 0, steer: 0, reset: false };
const SPAWN: SpawnPose = { position: { x: 0, y: 1.0, z: 0 }, yaw: 0 };
const GRASS_Y = 0.72;
const SLAB_Y = 0.95;

type World = ReturnType<typeof createPhysicsWorld>;

function addGrass(world: World): void {
  registerSurface(
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 5).setTranslation(0, GRASS_Y - 0.1, 0)),
    'grass',
  );
}

// Thin BARRIER_GROUP slabs just above the grass under each wheel, so the wheel
// rays cross them and the chassis cuboid never does.
function addBarrierSlabs(world: World): void {
  for (const [x, z] of SPEC.wheels.positions) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.15, 0.02, 0.15)
        .setTranslation(x, SLAB_Y - 0.02, z)
        .setCollisionGroups((BARRIER_GROUP << 16) | 0xffff),
    );
  }
}

function worldWith(slabs: boolean): World {
  const world = createPhysicsWorld();
  addGrass(world);
  if (slabs) addBarrierSlabs(world);
  world.step();
  return world;
}

function settle(world: World): VehicleModel {
  const car = new VehicleModel(world, SPEC, SPAWN);
  car.setInput(IDLE);
  for (let i = 0; i < 360; i++) {
    car.prePhysicsStep(FIXED_DT);
    world.step();
  }
  return car;
}

describe('268 wheel-ray call sites post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST70: getWheelSurfaces reports the surface under a barrier slab, not the slab', () => {
    const world = worldWith(true);
    try {
      const car = new VehicleModel(world, SPEC, SPAWN);
      expect(car.getWheelSurfaces(), 'every wheel sees the grass beneath the barrier').toEqual([
        'grass',
        'grass',
        'grass',
        'grass',
      ]);
    } finally {
      world.free();
    }
  });

  it('POST71: suspension rays settle on the ground, never on a barrier slab under the wheels', () => {
    const clean = worldWith(false);
    const slabs = worldWith(true);
    try {
      const yClean = settle(clean).body.translation().y;
      const ySlabs = settle(slabs).body.translation().y;
      expect(yClean, 'the car settles onto the grass strip').toBeGreaterThan(GRASS_Y);
      expect(ySlabs, 'a barrier slab under the wheels does not lift the car').toBeCloseTo(yClean, 2);
      expect(ySlabs, 'and the car is not riding on the slab').toBeLessThan(SLAB_Y + 0.3);
    } finally {
      clean.free();
      slabs.free();
    }
  });
});

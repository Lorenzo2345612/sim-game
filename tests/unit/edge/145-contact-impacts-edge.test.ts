import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Vec3 } from '../../../src/core/types';
import type { CarZones, DamageState } from '../../../src/physics/damage';
import {
  processContactEvents,
  toLocalPoint,
  type DamageCar,
  type DamageMode,
} from '../../../src/physics/contactEvents';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
const WALL_Z = 8;
const WALL_FACE = WALL_Z + 0.5;
const SPAWN_Y = 0.35;
const GAP_M = 2;
const SETTLE_S = 0.5;
const DRIVE_S = 2;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const rng = (): number => 0.5;

interface ContactVehicle extends Vehicle {
  readonly chassisCollider: RAPIER.Collider;
  readonly zones: CarZones;
  readonly damage: DamageState;
  damageMode: DamageMode;
}
const VehicleCtor = Vehicle as unknown as new (
  world: World,
  spec: CarSpec,
  spawn: SpawnPose,
) => ContactVehicle;

function loadSpec(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function tick(car: ContactVehicle): void {
  car.setInput(IDLE);
  car.prePhysicsStep(FIXED_DT);
}

function damageCarOf(car: ContactVehicle): DamageCar {
  return {
    chassis: car.chassisCollider,
    body: car.body,
    zones: car.zones,
    damage: car.damage,
    damageMode: car.damageMode,
  };
}

function snapshotDamage(state: DamageState): DamageState {
  return {
    frontWing: state.frontWing,
    rearWing: state.rearWing,
    suspension: [...state.suspension] as [number, number, number, number],
    puncture: [...state.puncture] as [boolean, boolean, boolean, boolean],
    detached: [...state.detached] as [boolean, boolean, boolean, boolean],
  };
}

function addWall(world: World): void {
  world.createCollider(RAPIER.ColliderDesc.cuboid(5, 2, 0.5).setTranslation(0, 1, WALL_Z));
}

function wallSpawn(spec: CarSpec): SpawnPose {
  return {
    position: { x: 0, y: SPAWN_Y, z: WALL_FACE + spec.chassis.halfExtents.z + GAP_M },
    yaw: 0,
  };
}

// Settle, launch at -v0 along -Z toward the wall, drive with processContactEvents per tick.
function driveIntoWall(
  spec: CarSpec,
  v0: number,
  damageMode: DamageMode,
  dtForTick: (i: number) => number,
): DamageState {
  const world = createPhysicsWorld();
  try {
    addWall(world);
    const car = new VehicleCtor(world, spec, wallSpawn(spec));
    car.damageMode = damageMode;
    const damageCar = damageCarOf(car);
    const queue = new RAPIER.EventQueue(true);
    for (let i = 0; i < steps(SETTLE_S); i++) {
      tick(car);
      world.step(queue);
      queue.drainContactForceEvents(() => {});
    }
    car.body.setLinvel({ x: 0, y: 0, z: -v0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < steps(DRIVE_S); i++) {
      tick(car);
      world.step(queue);
      processContactEvents(queue, world, [damageCar], dtForTick(i), rng);
    }
    return car.damage;
  } finally {
    world.free();
  }
}

describe('145 contact impacts edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: dt of 0, negative, NaN or Infinity is a no-op on a crashing car', () => {
    const spec = loadSpec();
    const badDts = [0, -1, NaN, Infinity];
    const dmg = driveIntoWall(spec, 30, 'full', (i) => badDts[i % badDts.length]);
    expect(dmg.frontWing).toBe(0);
    expect(dmg.rearWing).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(dmg.suspension[i]).toBe(0);
      expect(dmg.puncture[i]).toBe(false);
      expect(dmg.detached[i]).toBe(false);
    }
  });

  it('EDGE2: contact-force events whose colliders are not listed cars are ignored', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const dummyBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
          .setMass(10000)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(1000),
        dummyBody,
      );
      const car = new VehicleCtor(world, spec, { position: { x: 30, y: SPAWN_Y, z: 0 }, yaw: 0 });
      car.damageMode = 'full';
      const damageCar = damageCarOf(car);
      const queue = new RAPIER.EventQueue(true);
      for (let i = 0; i < steps(1); i++) {
        tick(car);
        world.step(queue);
        processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
      }
      expect(car.damage).toEqual({
        frontWing: 0,
        rearWing: 0,
        suspension: [0, 0, 0, 0],
        puncture: [false, false, false, false],
        detached: [false, false, false, false],
      });
    } finally {
      world.free();
    }
  });

  it('EDGE3: visual mode accumulates wing damage like full', () => {
    const spec = loadSpec();
    const dmg = driveIntoWall(spec, 30, 'visual', () => FIXED_DT);
    expect(dmg.frontWing).toBeGreaterThanOrEqual(0.5);
  });

  it('EDGE4: mode off is per car — the hit partner still takes damage', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const a = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 0 }, yaw: 0 });
      const b = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 10 }, yaw: 0 });
      a.damageMode = 'off';
      b.damageMode = 'full';
      const cars: DamageCar[] = [damageCarOf(a), damageCarOf(b)];
      const queue = new RAPIER.EventQueue(true);
      for (let i = 0; i < steps(SETTLE_S); i++) {
        tick(a);
        tick(b);
        world.step(queue);
        queue.drainContactForceEvents(() => {});
      }
      b.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < steps(DRIVE_S); i++) {
        tick(a);
        tick(b);
        world.step(queue);
        processContactEvents(queue, world, cars, FIXED_DT, rng);
      }
      expect(a.damage.rearWing).toBe(0);
      expect(a.damage.frontWing).toBe(0);
      for (let i = 0; i < 4; i++) {
        expect(a.damage.suspension[i]).toBe(0);
        expect(a.damage.puncture[i]).toBe(false);
        expect(a.damage.detached[i]).toBe(false);
      }
      expect(b.damage.frontWing).toBeGreaterThan(0);
    } finally {
      world.free();
    }
  });

  it('EDGE5: the chassis collider enables contact-force events at the 1000 N threshold', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const car = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 0 }, yaw: 0 });
      const events = car.chassisCollider.activeEvents();
      expect(events & RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).toBe(
        RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS,
      );
      expect(car.chassisCollider.contactForceEventThreshold()).toBe(1000);
    } finally {
      world.free();
    }
  });

  it('EDGE6: zones mirror the chassis half extents and the spec wheel positions', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const car = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 0 }, yaw: 0 });
      expect(car.zones.halfLength).toBeCloseTo(spec.chassis.halfExtents.z, 9);
      expect(car.zones.halfWidth).toBeCloseTo(spec.chassis.halfExtents.x, 9);
      for (let i = 0; i < 4; i++) {
        expect(car.zones.hubs[i].x).toBeCloseTo(spec.wheels.positions[i][0], 9);
        expect(car.zones.hubs[i].y).toBeCloseTo(spec.wheels.positions[i][1], 9);
        expect(car.zones.hubs[i].z).toBeCloseTo(spec.wheels.positions[i][2], 9);
      }
    } finally {
      world.free();
    }
  });

  it('EDGE7: toLocalPoint with identity rotation subtracts the car position and returns out', () => {
    const out: Vec3 = { x: 9, y: 9, z: 9 };
    const returned = toLocalPoint({ x: 3, y: 4, z: 5 }, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 }, out);
    expect(returned).toBe(out);
    expect(out.x).toBeCloseTo(2, 9);
    expect(out.y).toBeCloseTo(2, 9);
    expect(out.z).toBeCloseTo(2, 9);
  });

  it('EDGE8: re-processing the drained queue within a tick changes nothing', () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      addWall(world);
      const car = new VehicleCtor(world, spec, wallSpawn(spec));
      car.damageMode = 'full';
      const damageCar = damageCarOf(car);
      const queue = new RAPIER.EventQueue(true);
      for (let i = 0; i < steps(SETTLE_S); i++) {
        tick(car);
        world.step(queue);
        queue.drainContactForceEvents(() => {});
      }
      car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < steps(DRIVE_S); i++) {
        tick(car);
        world.step(queue);
        processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
        const once = snapshotDamage(car.damage);
        processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
        processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
        expect(car.damage).toEqual(once);
      }
      expect(car.damage.frontWing).toBeGreaterThanOrEqual(0.5);
    } finally {
      world.free();
    }
  });
});

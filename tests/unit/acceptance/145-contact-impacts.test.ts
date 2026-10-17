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
const TOL = 1e-9;
const WALL_Z = 8; // wall centre; its +z face sits at 8.5
const WALL_FACE = WALL_Z + 0.5;
const SPAWN_Y = 0.35;
const GAP_M = 2; // metres from the car nose to the wall face at launch
const SETTLE_S = 0.5;
const DRIVE_S = 2;
const WING_J0 = 1500;
const WING_JK = 6000;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const rng = (): number => 0.5;

// Chassis collider, zones, damage and damageMode are public on Vehicle from task 145.
// Declared here and cast so typecheck stays green pre-implementation.
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

// Settle at rest, launch at v0 along -Z toward the wall, drive 2 s with contacts processed.
function driveIntoWall(spec: CarSpec, v0: number, damageMode: DamageMode): DamageState {
  const world = createPhysicsWorld();
  try {
    world.createCollider(RAPIER.ColliderDesc.cuboid(5, 2, 0.5).setTranslation(0, 1, WALL_Z));
    const spawn: SpawnPose = {
      position: { x: 0, y: SPAWN_Y, z: WALL_FACE + spec.chassis.halfExtents.z + GAP_M },
      yaw: 0,
    };
    const car = new VehicleCtor(world, spec, spawn);
    car.damageMode = damageMode;
    const damageCar: DamageCar = {
      chassis: car.chassisCollider,
      body: car.body,
      zones: car.zones,
      damage: car.damage,
      damageMode: car.damageMode,
    };
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
      processContactEvents(queue, world, [damageCar], FIXED_DT, rng);
    }
    return car.damage;
  } finally {
    world.free();
  }
}

describe('145 contact impacts acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: toLocalPoint maps the world point into the rotated car frame', () => {
    const out: Vec3 = { x: 0, y: 0, z: 0 };
    const half = Math.SQRT1_2;
    toLocalPoint({ x: 10, y: 0.3, z: 3 }, { x: 10, y: 0, z: 5 }, { x: 0, y: half, z: 0, w: half }, out);
    expect(Math.abs(out.x - 2)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(out.y - 0.3)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(out.z - 0)).toBeLessThanOrEqual(TOL);
  });

  it(
    'AT2: a 30 m/s head-on wall impact damages the front wing; at 5 m/s the front wing stays 0',
    () => {
      const spec = loadSpec();
      const fast = driveIntoWall(spec, 30, 'full');
      expect(fast.frontWing).toBeGreaterThanOrEqual(0.5);
      const slow = driveIntoWall(spec, 5, 'full');
      expect(slow.frontWing).toBeCloseTo(0, 9);
    },
    30000,
  );

  it(
    'AT3: a car-to-car rear hit damages both wings with the same impulse',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        const a = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 0 }, yaw: 0 });
        const b = new VehicleCtor(world, spec, { position: { x: 0, y: SPAWN_Y, z: 10 }, yaw: 0 });
        a.damageMode = 'full';
        b.damageMode = 'full';
        const cars: DamageCar[] = [
          { chassis: a.chassisCollider, body: a.body, zones: a.zones, damage: a.damage, damageMode: a.damageMode },
          { chassis: b.chassisCollider, body: b.body, zones: b.zones, damage: b.damage, damageMode: b.damageMode },
        ];
        const queue = new RAPIER.EventQueue(true);
        for (let i = 0; i < steps(SETTLE_S); i++) {
          tick(a);
          tick(b);
          world.step(queue);
          queue.drainContactForceEvents(() => {});
        }
        b.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Wing damage of the first contact event inverts to J = damage·Jk + J0 (unsaturated).
        let jA = NaN;
        let jB = NaN;
        for (let i = 0; i < steps(DRIVE_S); i++) {
          tick(a);
          tick(b);
          world.step(queue);
          processContactEvents(queue, world, cars, FIXED_DT, rng);
          if (Number.isNaN(jA) && (a.damage.rearWing > 0 || b.damage.frontWing > 0)) {
            jA = a.damage.rearWing * WING_JK + WING_J0;
            jB = b.damage.frontWing * WING_JK + WING_J0;
          }
        }
        expect(a.damage.rearWing).toBeGreaterThan(0);
        expect(b.damage.frontWing).toBeGreaterThan(0);
        expect(Math.abs(jA - jB)).toBeLessThanOrEqual(1e-6 * jA);
      } finally {
        world.free();
      }
    },
    30000,
  );

  it(
    'AT4: damage mode off ignores the 30 m/s wall impact entirely',
    () => {
      const dmg = driveIntoWall(loadSpec(), 30, 'off');
      expect(dmg.frontWing).toBeCloseTo(0, 9);
      expect(dmg.rearWing).toBeCloseTo(0, 9);
      for (let i = 0; i < 4; i++) {
        expect(dmg.suspension[i]).toBeCloseTo(0, 9);
        expect(dmg.puncture[i]).toBe(false);
        expect(dmg.detached[i]).toBe(false);
      }
    },
    30000,
  );
});

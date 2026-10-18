import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { DebrisField } from '../../../src/physics/debris';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, Vec3 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function loadSpec(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

describe('147 debris acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: a detached FR wheel spawns one debris body at 40 m/s and hides the car wheel node', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 1);
      field.spawn('wheel', 0, 1, { x: 0, y: 0.3, z: 10 }, { x: 0, y: 0, z: -40 });
      expect(field.count).toBe(1);
      const bodies = field.getBodies();
      expect(bodies).toHaveLength(1);
      const v = bodies[0].linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      expect(speed).toBeGreaterThanOrEqual(38);
      expect(speed).toBeLessThanOrEqual(42);
      expect(field.wheelHidden(0, 1)).toBe(true);
    } finally {
      world.free();
    }
  });

  it('AT2: the tenth spawn keeps at most 8 debris and removes the oldest first', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 7);
      for (let i = 0; i < 10; i++) {
        const pos: Vec3 = { x: i * 10, y: 0.5, z: 0 };
        if (i % 2 === 0) {
          field.spawn('frontWing', 0, -1, pos, ZERO);
        } else {
          field.spawn('wheel', 0, i % 4, pos, ZERO);
        }
      }
      expect(field.count).toBeLessThanOrEqual(8);
      const xs = field
        .getBodies()
        .map((b: RAPIER.RigidBody) => b.translation().x)
        .sort((a: number, b: number) => a - b);
      expect(xs).toHaveLength(field.count);
      expect(xs[0]).toBeCloseTo(20, 6);
      expect(xs[xs.length - 1]).toBeCloseTo(90, 6);
      expect(xs).not.toContain(0);
      expect(xs).not.toContain(10);
    } finally {
      world.free();
    }
  });

  it('AT3: debris left alone for 61 s is removed', () => {
    const world = createPhysicsWorld();
    try {
      const field = new DebrisField(world, 2);
      field.spawn('rearWing', 0, -1, { x: 4, y: 0.4, z: 6 }, ZERO);
      expect(field.count).toBe(1);
      const car: Vec3 = { x: 4, y: 0, z: 6 };
      for (let i = 0; i < steps(61); i++) {
        field.step(FIXED_DT, [car]);
      }
      expect(field.count).toBe(0);
    } finally {
      world.free();
    }
  });

  it(
    'AT4: a car driving through a debris wheel at 30 m/s gets a contact event and no NaN',
    () => {
      const spec = loadSpec();
      const world = createPhysicsWorld();
      try {
        world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0));
        const field = new DebrisField(world, 4);
        const spawn: SpawnPose = { position: { x: 0, y: 0.35, z: 20 }, yaw: 0 };
        const car = new Vehicle(world, spec, spawn);
        field.spawn('wheel', 0, 1, { x: 0, y: spec.wheels.radius, z: 5 }, ZERO);
        const debrisCol = field.getBodies()[0].collider();
        car.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
        const queue = new RAPIER.EventQueue(true);
        let contact = false;
        let badForce = false;
        for (let i = 0; i < steps(1.5); i++) {
          car.setInput(IDLE);
          car.prePhysicsStep(FIXED_DT);
          world.step(queue);
          queue.drainContactForceEvents((event) => {
            const h1 = event.collider1();
            const h2 = event.collider2();
            const pair =
              (h1 === car.chassisCollider.handle && h2 === debrisCol.handle) ||
              (h2 === car.chassisCollider.handle && h1 === debrisCol.handle);
            if (pair) {
              contact = true;
              if (!Number.isFinite(event.totalForceMagnitude())) badForce = true;
            }
          });
        }
        expect(contact).toBe(true);
        expect(badForce).toBe(false);
        const v = car.body.linvel();
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
        const dv = field.getBodies()[0].linvel();
        expect(Number.isFinite(dv.x) && Number.isFinite(dv.y) && Number.isFinite(dv.z)).toBe(true);
      } finally {
        world.free();
      }
    },
    30000,
  );
});

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initPhysics, createPhysicsWorld } from '../../src/physics/physicsWorld';
import { Vehicle } from '../../src/physics/vehicle';
import { parseCarSpec } from '../../src/physics/carSpec';
import { FIXED_DT } from '../../src/core/constants';

const SPEC = parseCarSpec(
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
);
const IDLE = { throttle: 0, brake: 0, steer: 0, reset: false };

function stepAll(world: ReturnType<typeof createPhysicsWorld>, cars: Vehicle[], s: number): void {
  const n = Math.round(s / FIXED_DT);
  for (let i = 0; i < n; i++) {
    for (const c of cars) {
      c.setInput(IDLE);
      c.prePhysicsStep(FIXED_DT);
    }
    world.step();
  }
}

describe('car wheel hitbox', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('wheels of side-by-side cars collide although chassis slabs do not touch', () => {
    const world = createPhysicsWorld();
    const he = SPEC.chassis.halfExtents;
    const outer = Math.abs(SPEC.wheels.positions[0][0]) + SPEC.wheels.width / 2;
    expect(outer).toBeGreaterThan(he.x);
    // gap between the slabs 0.1 m, tyres overlap by > 0.1 m
    const dx = 2 * he.x + 0.1;
    expect(dx).toBeLessThan(2 * outer - 0.1);
    const a = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    const b = new Vehicle(world, SPEC, { position: { x: dx, y: 0.6, z: 0 }, yaw: 0 });
    let touched = false;
    for (let i = 0; i < Math.round(1 / FIXED_DT) && !touched; i++) {
      stepAll(world, [a, b], FIXED_DT);
      for (const ca of a.carColliders) {
        for (const cb of b.carColliders) {
          world.contactPair(ca, cb, (m) => {
            if (m.numContacts() > 0) touched = true;
          });
        }
      }
    }
    expect(touched).toBe(true);
    world.free();
  });

  it('suspension rest height is unchanged by the car-car colliders', () => {
    const rest = (strip: boolean): number => {
      const world = createPhysicsWorld();
      const v = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
      if (strip) for (const c of v.carColliders) world.removeCollider(c, false);
      stepAll(world, [v], 2);
      const y = v.getState().position.y;
      world.free();
      return y;
    };
    expect(Math.abs(rest(false) - rest(true))).toBeLessThanOrEqual(1e-6);
  });

  it('car alone on flat ground: car-car colliders never touch the ground', () => {
    const world = createPhysicsWorld();
    const v = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    stepAll(world, [v], 1.5);
    let contacts = 0;
    world.forEachCollider((col) => {
      if (col.parent() === v.chassisCollider.parent()) return;
      for (const c of v.carColliders) {
        world.contactPair(c, col, (m) => {
          contacts += m.numContacts();
        });
      }
    });
    expect(contacts).toBe(0);
    world.free();
  });
});

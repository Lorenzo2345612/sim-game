import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { FIXED_DT, GRAVITY } from '../../../src/core/constants';

describe('physicsWorld extras', () => {
  let worlds: RAPIER.World[] = [];

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) {
      w.free();
    }
    worlds = [];
  });

  it('initPhysics returns the same memoized promise on repeated calls', () => {
    expect(initPhysics()).toBe(initPhysics());
  });

  it('createPhysicsWorld uses the shared constants for gravity and timestep', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    // Rapier stores the timestep as f32, so compare with a tolerance.
    expect(world.gravity.y).toBeCloseTo(GRAVITY, 9);
    expect(world.timestep).toBeCloseTo(FIXED_DT, 9);
  });

  it('the ground is a single bodyless cuboid with its top surface at y=0', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    const colliders: RAPIER.Collider[] = [];
    world.forEachCollider((c) => colliders.push(c));
    expect(colliders.length).toBe(1);
    const ground = colliders[0];
    expect(ground.parent()).toBeNull();
    const he = ground.halfExtents();
    if (!he) throw new Error('ground collider is not a cuboid');
    expect(he.x).toBeCloseTo(5000, 6);
    expect(he.y).toBeCloseTo(0.5, 6);
    expect(he.z).toBeCloseTo(5000, 6);
    expect(ground.translation().y + he.y).toBeCloseTo(0, 6);
    expect(world.bodies.len()).toBe(0);
  });

  it('each call to createPhysicsWorld returns an independent world with its own ground', () => {
    const a = createPhysicsWorld();
    const b = createPhysicsWorld();
    worlds.push(a, b);
    expect(a).not.toBe(b);
    a.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
    expect(a.bodies.len()).toBe(1);
    expect(b.bodies.len()).toBe(0);
    let countB = 0;
    b.forEachCollider(() => countB++);
    expect(countB).toBe(1);
  });

  it('a resting cube stays at rest through a long extra run of steps', () => {
    const world = createPhysicsWorld();
    worlds.push(world);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    for (let i = 0; i < 360; i++) {
      world.step();
    }
    const yAfter3s = body.translation().y;
    for (let i = 0; i < 1200; i++) {
      world.step();
    }
    expect(Math.abs(body.translation().y - yAfter3s)).toBeLessThan(0.02);
    expect(Math.abs(body.translation().y - 0.5)).toBeLessThan(0.05);
    const v = body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.1);
  });
});

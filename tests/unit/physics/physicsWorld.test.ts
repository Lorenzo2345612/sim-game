import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';

describe('physicsWorld', () => {
  let world: ReturnType<typeof createPhysicsWorld> | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('initPhysics can be called twice without failing', async () => {
    await expect(initPhysics()).resolves.toBeUndefined();
    await expect(initPhysics()).resolves.toBeUndefined();
  });

  it('world gravity and timestep', () => {
    world = createPhysicsWorld();
    expect(world.gravity.x).toBeCloseTo(0, 9);
    expect(world.gravity.y).toBeCloseTo(-9.81, 9);
    expect(world.gravity.z).toBeCloseTo(0, 9);
    expect(world.timestep).toBeCloseTo(1 / 120, 9);
  });

  it('dynamic cube dropped from y=5 rests at y≈0.5', () => {
    world = createPhysicsWorld();
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
    for (let i = 0; i < 360; i++) {
      world!.step();
    }
    expect(Math.abs(body.translation().y - 0.5)).toBeLessThan(0.05);
  });

  it('PLACEHOLDER_CAR matches architecture values', () => {
    expect(PLACEHOLDER_CAR.massKg).toBe(650);
    expect(PLACEHOLDER_CAR.wheelRadius).toBe(0.33);
    expect(PLACEHOLDER_CAR.enginePowerW).toBe(130000);
    expect(PLACEHOLDER_CAR.brakeMax).toBe(20);
    expect(PLACEHOLDER_CAR.wheelPositions.length).toBe(4);
    expect(PLACEHOLDER_CAR.wheelPositions[0].z).toBe(-1.3);
    expect(PLACEHOLDER_CAR.wheelPositions[1].z).toBe(-1.3);
    expect(PLACEHOLDER_CAR.wheelPositions[2].z).toBe(1.25);
    expect(PLACEHOLDER_CAR.wheelPositions[3].z).toBe(1.25);
  });
});

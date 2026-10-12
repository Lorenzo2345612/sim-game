import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
  RAPIER,
} from '../../../src/physics/physicsWorld';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';

function within(actual: number, expected: number, tol = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('010 physics world and car config acceptance', () => {
  let world: ReturnType<typeof createPhysicsWorld> | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: initPhysics called twice resolves both times without error', async () => {
    const p1 = initPhysics();
    const p2 = initPhysics();
    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
  });

  it('AT2: a fresh world has gravity (0, -9.81, 0) and timestep 1/120', () => {
    world = createPhysicsWorld();
    within(world.gravity.x, 0);
    within(world.gravity.y, -9.81);
    within(world.gravity.z, 0);
    within(world.timestep, 1 / 120, 1e-9);
  });

  it('AT3: a dynamic 1x1x1 m cube dropped at y=5 rests on the ground at y=0.5 after 360 steps', () => {
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

  it('AT4: PLACEHOLDER_CAR equals the architecture.md values', () => {
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

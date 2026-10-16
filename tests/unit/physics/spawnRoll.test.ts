import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { Quat, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();
const YAW = 0.7;

function applyQ(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

function spawn(roll?: number): SpawnPose {
  return { position: { x: 0, y: 0.6, z: 0 }, yaw: YAW, roll };
}

describe('bank-aware spawn roll', () => {
  let world: World;
  let vehicle: Vehicle;

  beforeAll(async () => {
    await initPhysics();
  });

  beforeEach(() => {
    world = createPhysicsWorld();
    vehicle = new Vehicle(world, SPEC, spawn(0));
  });

  afterEach(() => {
    world.free();
  });

  it('reset with roll 0.5 tilts the body up vector 0.5 rad from world Y', () => {
    vehicle.reset(spawn(0.5));
    const q = vehicle.getState().rotation;
    const up = applyQ(q, 0, 1, 0);
    const angle = Math.acos(Math.max(-1, Math.min(1, up[1] / Math.hypot(up[0], up[1], up[2]))));
    expect(Math.abs(angle - 0.5)).toBeLessThanOrEqual(0.01);
  });

  // Rapier stores f32 rotations, so compare against the yaw-only quaternion to 1e-6.
  it('reset with roll 0 or absent reproduces the yaw-only quaternion', () => {
    const yawOnly: Quat = { x: 0, y: Math.sin(YAW / 2), z: 0, w: Math.cos(YAW / 2) };
    for (const pose of [spawn(0), { position: spawn().position, yaw: YAW }]) {
      vehicle.reset(pose);
      const q = vehicle.getState().rotation;
      expect(q.x).toBeCloseTo(yawOnly.x, 6);
      expect(q.y).toBeCloseTo(yawOnly.y, 6);
      expect(q.z).toBeCloseTo(yawOnly.z, 6);
      expect(q.w).toBeCloseTo(yawOnly.w, 6);
    }
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { repairTime, widgetColour, type DamageState } from '../../../src/physics/damage';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();
const STATIC_Y = SPEC.chassis.cgHeight;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function run(vehicle: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    vehicle.setInput(inp);
    vehicle.prePhysicsStep(FIXED_DT);
    world.step();
  }
}

describe('148 damage HUD, pit repair and AI slowdown acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: frontWing 0.3, suspension [0, 0.5, 0, 0], puncture[1] gives repairTime 3 + 8 + 4 = 15 s', () => {
    const state: DamageState = {
      frontWing: 0.3,
      rearWing: 0,
      suspension: [0, 0.5, 0, 0],
      puncture: [false, true, false, false],
      detached: [false, false, false, false],
    };
    expect(repairTime(state)).toBeCloseTo(15, 6);
  });

  it('AT2: part values 0.1 / 0.4 / 0.7 / detached give widgetColour green / yellow / red / black', () => {
    expect(widgetColour(0.1, false)).toBe('green');
    expect(widgetColour(0.4, false)).toBe('yellow');
    expect(widgetColour(0.7, false)).toBe('red');
    expect(widgetColour(1, true)).toBe('black');
  });

  it('AT3: setting visual with frontWing 1 leaves front downforce unchanged (undamaged)', () => {
    const frontAt = (mode: 'full' | 'visual', frontWing: number): number => {
      const world = createPhysicsWorld();
      const vehicle = new Vehicle(world, SPEC, spawn(STATIC_Y));
      vehicle.damageMode = mode;
      vehicle.damage.frontWing = frontWing;
      run(vehicle, world, 2, IDLE);
      vehicle.body.setLinvel({ x: 0, y: 0, z: -60 }, true);
      vehicle.prePhysicsStep(FIXED_DT);
      const out = vehicle.getDownforce({ front: 0, rear: 0 });
      world.free();
      return out.front;
    };
    const damaged = frontAt('visual', 1);
    const undamaged = frontAt('visual', 0);
    expect(Math.abs(damaged - undamaged)).toBeLessThanOrEqual(0.01 * Math.abs(undamaged));
  }, 30000);
});

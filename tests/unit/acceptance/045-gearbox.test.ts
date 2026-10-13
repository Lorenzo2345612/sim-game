import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Gearbox, rpmFor } from '../../../src/physics/gearbox';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;
// Task 045 target signature; the intersection keeps this file typechecking before Vehicle has it.
type VehicleWithGearbox = Vehicle & {
  gear(): number;
  rpm(): number;
  shiftUp(): void;
  setGearMode(mode: 'auto' | 'manual'): void;
};

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function step(car: Vehicle, world: World, inp: DriverInput): void {
  car.setInput(inp);
  car.prePhysicsStep(FIXED_DT);
  world.step();
}

describe('045 gearbox acceptance', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: idle clamp — gear 1 at 0 m/s gives 3000 rpm', () => {
    const gb = new Gearbox();
    expect(gb.gear).toBe(1);
    expect(gb.rpm(0)).toBeCloseTo(3000, 0);
  });

  it('AT2: gear 3 at 30 m/s gives rpm within ±1 of 30/0.33 × 1.8 × 3.4 × 60/2π', () => {
    const expected = (30 / 0.33) * 1.8 * 3.4 * (60 / (2 * Math.PI));
    expect(Math.abs(rpmFor(30, 3) - expected)).toBeLessThanOrEqual(1);
  });

  it('AT3: auto acceleration past 8500 rpm upshifts one gear per update and never exceeds gear 6', () => {
    const gb = new Gearbox();
    expect(gb.mode).toBe('auto');
    expect(gb.gear).toBe(1);
    const shifts: Array<[number, number]> = [[28, 2], [40, 3], [50, 4], [62, 5], [75, 6], [90, 6]];
    for (const [speed, gearAfter] of shifts) {
      gb.update(speed);
      expect(gb.gear).toBe(gearAfter);
      expect(gb.gear).toBeLessThanOrEqual(6);
    }
  });

  it('AT4: auto braking below 5000 rpm downshifts one gear per update and stops at gear 1', () => {
    const gb = new Gearbox();
    gb.update(50);
    gb.update(50);
    gb.update(50);
    expect(gb.gear).toBe(4);
    gb.update(30);
    expect(gb.gear).toBe(3);
    gb.update(22);
    expect(gb.gear).toBe(2);
    gb.update(15);
    expect(gb.gear).toBe(1);
    gb.update(0);
    expect(gb.gear).toBe(1);
  });

  it('AT5: manual gear 2 at the 9000 rpm limiter gives zero drive force under throttle', () => {
    world = createPhysicsWorld();
    const car = new Vehicle(world, PLACEHOLDER_CAR, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step(car, world, IDLE);
    const v = car as VehicleWithGearbox;
    v.setGearMode('manual');
    v.shiftUp();
    expect(v.gear()).toBe(2);
    // 40 m/s in gear 2 ≈ 9052 rpm, at/above the 9000 limiter.
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -40 }, true);
    const v0 = car.getState().forwardSpeed;
    step(car, world, FULL);
    expect(v.rpm()).toBeGreaterThanOrEqual(9000);
    for (let i = 0; i < Math.round(1 / FIXED_DT) - 1; i++) step(car, world, FULL);
    expect(car.getState().forwardSpeed).toBeLessThanOrEqual(v0 + 0.1);
  }, 20000);

  it('AT6: manual shiftUp ×7 clamps at gear 6 and shiftDown ×7 clamps at gear 1', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    expect(gb.mode).toBe('manual');
    for (let i = 0; i < 7; i++) gb.shiftUp();
    expect(gb.gear).toBe(6);
    for (let i = 0; i < 7; i++) gb.shiftDown();
    expect(gb.gear).toBe(1);
  });
});

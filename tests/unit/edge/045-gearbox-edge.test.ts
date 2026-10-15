import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Gearbox, rpmFor } from '../../../src/physics/gearbox';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;
// Task 045 target signature; the intersection keeps this file typechecking before Vehicle has it.
type VehicleWithGearbox = Vehicle & {
  gear(): number;
  rpm(): number;
  shiftUp(): void;
  shiftDown(): void;
  setGearMode(mode: 'auto' | 'manual'): void;
};

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RATIOS = [3.2, 2.3, 1.8, 1.45, 1.2, 1.0];
const FINAL_DRIVE = 3.4;

function expectedRpm(speedMs: number, gear: number): number {
  return (Math.abs(speedMs) / 0.33) * RATIOS[gear - 1] * FINAL_DRIVE * (60 / (2 * Math.PI));
}

function step(car: Vehicle, world: World, inp: DriverInput): void {
  car.setInput(inp);
  car.prePhysicsStep(FIXED_DT);
  world.step();
}

function settle(world: World): Vehicle {
  const car = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
  for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step(car, world, IDLE);
  return car;
}

describe('045 gearbox edge cases', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('EDGE1: rpmFor uses the absolute speed — reversing reads the same rpm as forward', () => {
    for (const [v, gear] of [
      [30, 3],
      [15, 1],
      [50, 4],
    ] as const) {
      expect(rpmFor(-v, gear)).toBeCloseTo(rpmFor(v, gear), 6);
      expect(rpmFor(-v, gear)).toBeCloseTo(expectedRpm(v, gear), 0);
    }
  });

  it('EDGE2: the idle clamp applies at any speed below the idle threshold, not only at zero', () => {
    // Gear 6 raw rpm at 1 m/s ≈ 98 and at 5 m/s ≈ 492, both below IDLE_RPM.
    expect(rpmFor(1, 6)).toBeCloseTo(3000, 0);
    expect(rpmFor(5, 6)).toBeCloseTo(3000, 0);
    expect(rpmFor(-5, 6)).toBeCloseTo(3000, 0);
    // Above the clamp the formula takes over (gear 6 passes 3000 rpm at ~30.5 m/s).
    expect(rpmFor(40, 6)).toBeCloseTo(expectedRpm(40, 6), 0);
  });

  it('EDGE3: auto update shifts exactly one gear per call even when the next gear still crosses the threshold', () => {
    const gb = new Gearbox();
    gb.update(75); // gear 1 ≈ 23614 rpm; gear 2 still ≈ 16972 rpm, above UPSHIFT_RPM
    expect(gb.gear).toBe(2);
    gb.update(75); // gear 2 ≈ 16972 rpm; gear 3 still ≈ 13284 rpm
    expect(gb.gear).toBe(3);
    gb.update(6); // gear 3 at 6 m/s reads idle (raw ≈ 1062 rpm), two gears below the threshold
    expect(gb.gear).toBe(2);
    gb.update(6);
    expect(gb.gear).toBe(1);
    gb.update(6);
    expect(gb.gear).toBe(1);
  });

  it('EDGE4: manual mode ignores the auto rpm thresholds on update', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    gb.update(90); // gear 1 at 90 m/s ≈ 28339 rpm, far above UPSHIFT_RPM
    expect(gb.gear).toBe(1);
    expect(gb.rpm(90)).toBeGreaterThanOrEqual(9000);
    gb.shiftUp();
    gb.shiftUp();
    gb.shiftUp(); // gear 4
    gb.update(1); // gear 4 at 1 m/s reads idle (raw ≈ 143 rpm), far below DOWNSHIFT_RPM
    expect(gb.gear).toBe(4);
  });

  it('EDGE5: shiftUp and shiftDown are no-ops while the mode is auto', () => {
    const gb = new Gearbox();
    gb.shiftUp();
    expect(gb.gear).toBe(1);
    gb.update(50);
    gb.update(50);
    gb.update(50); // three auto upshifts: gear 4
    expect(gb.gear).toBe(4);
    gb.shiftDown();
    expect(gb.gear).toBe(4);
    gb.shiftUp();
    expect(gb.gear).toBe(4);
  });

  it('EDGE6: driveScale is 1 below the limiter and 0 at or above it, in every gear band', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    gb.shiftUp(); // gear 2: 39 m/s ≈ 8825 rpm, 40 m/s ≈ 9052 rpm
    expect(gb.driveScale(39)).toBe(1);
    expect(gb.driveScale(40)).toBe(0);
    gb.shiftDown(); // gear 1: 28 m/s ≈ 8816 rpm, 29 m/s ≈ 9130 rpm
    expect(gb.driveScale(28)).toBe(1);
    expect(gb.driveScale(29)).toBe(0);
    for (let i = 0; i < 5; i++) gb.shiftUp(); // gear 6: 91 m/s ≈ 8953 rpm, 92 m/s ≈ 9052 rpm
    expect(gb.driveScale(91)).toBe(1);
    expect(gb.driveScale(92)).toBe(0);
    expect(gb.driveScale(0)).toBe(1);
  });

  it('EDGE7: a settled vehicle starts in gear 1 at idle rpm (gearbox.update wired each step)', () => {
    world = createPhysicsWorld();
    const car = settle(world);
    const v = car as VehicleWithGearbox;
    expect(v.gear()).toBe(1);
    expect(v.rpm()).toBeCloseTo(SPEC.engine.idleRpm, 0);
  }, 20000);

  it('EDGE8: the vehicle auto-upshifts during full-throttle acceleration', () => {
    world = createPhysicsWorld();
    const car = settle(world);
    const v = car as VehicleWithGearbox;
    const maxSteps = Math.round(8 / FIXED_DT);
    for (let i = 0; i < maxSteps; i++) {
      step(car, world, FULL);
      if (car.getState().forwardSpeed >= 30) break;
    }
    expect(car.getState().forwardSpeed).toBeGreaterThanOrEqual(30);
    // Gear 1 upshifts at (6400/60×2π)·0.28/(2.3·3.5) ≈ 23.3 m/s, gear 2 not until ≈ 31.9 m/s.
    expect(v.gear()).toBe(2);
  }, 20000);

  it('EDGE9: vehicle shiftUp/shiftDown delegate to the gearbox', () => {
    world = createPhysicsWorld();
    const car = settle(world);
    const v = car as VehicleWithGearbox;
    v.setGearMode('manual');
    v.shiftUp();
    v.shiftUp();
    expect(v.gear()).toBe(3);
    v.shiftDown();
    expect(v.gear()).toBe(2);
    v.shiftDown();
    v.shiftDown();
    v.shiftDown();
    expect(v.gear()).toBe(1);
  }, 20000);

  it('EDGE10: the limiter does not latch — drive force resumes once rpm falls back below it', () => {
    world = createPhysicsWorld();
    const car = settle(world);
    const v = car as VehicleWithGearbox;
    v.setGearMode('manual');
    v.shiftUp(); // gear 2
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -40 }, true); // ≈ 8021 rpm, at the limiter
    step(car, world, FULL);
    expect(v.rpm()).toBeGreaterThanOrEqual(SPEC.engine.limiterRpm);
    expect(car.getState().forwardSpeed).toBeLessThanOrEqual(40.1);
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -30 }, true); // ≈ 6016 rpm, below the limiter
    let maxRpm = v.rpm();
    for (let i = 0; i < Math.round(0.5 / FIXED_DT); i++) {
      step(car, world, FULL);
      maxRpm = Math.max(maxRpm, v.rpm());
    }
    const atHalf = car.getState().forwardSpeed;
    for (let i = 0; i < Math.round(1.5 / FIXED_DT); i++) {
      step(car, world, FULL);
      maxRpm = Math.max(maxRpm, v.rpm());
    }
    expect(car.getState().forwardSpeed).toBeGreaterThan(atHalf);
    expect(maxRpm).toBeLessThanOrEqual(SPEC.engine.limiterRpm);
  }, 20000);
});

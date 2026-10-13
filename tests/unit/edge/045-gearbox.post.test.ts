import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Gearbox, rpmFor, IDLE_RPM, LIMITER_RPM, UPSHIFT_RPM, DOWNSHIFT_RPM } from '../../../src/physics/gearbox';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RATIOS = [3.2, 2.3, 1.8, 1.45, 1.2, 1.0];

function speedAtRpm(rpm: number, gear: number): number {
  return (rpm * 0.33) / (RATIOS[gear - 1] * 3.4 * (60 / (2 * Math.PI)));
}

function step(car: Vehicle, world: World, inp: DriverInput): void {
  car.setInput(inp);
  car.prePhysicsStep(FIXED_DT);
  world.step();
}

describe('045 gearbox post-code gaps', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('rpmFor clamps out-of-range gears to the gear 1 and gear 6 ratios', () => {
    for (const gear of [0, -3, -100]) {
      expect(rpmFor(30, gear)).toBeCloseTo(rpmFor(30, 1), 6);
    }
    for (const gear of [7, 99]) {
      expect(rpmFor(30, gear)).toBeCloseTo(rpmFor(30, 6), 6);
    }
  });

  it('driveScale flips at the limiter in gears 3-5 as well', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    for (let gear = 3; gear <= 5; gear++) {
      while (gb.gear < gear) gb.shiftUp();
      const vOn = speedAtRpm(LIMITER_RPM, gear);
      expect(gb.driveScale(vOn - 0.1)).toBe(1);
      expect(gb.driveScale(vOn + 0.1)).toBe(0);
    }
  });

  it('update with a NaN speed leaves the gear unchanged', () => {
    const gb = new Gearbox();
    gb.update(50);
    gb.update(50);
    expect(gb.gear).toBe(3);
    gb.update(Number.NaN);
    expect(gb.gear).toBe(3);
  });

  it('a reversing vehicle drops back to gear 1 and reads rpm from the speed magnitude', async () => {
    world = createPhysicsWorld();
    const car = new Vehicle(world, PLACEHOLDER_CAR, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step(car, world, IDLE);
    for (let i = 0; i < Math.round(8 / FIXED_DT); i++) {
      step(car, world, FULL);
      if (car.getState().forwardSpeed >= 30) break;
    }
    expect(car.gear()).toBe(2);
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: 15 }, true);
    step(car, world, IDLE);
    expect(car.gear()).toBe(1);
    expect(car.rpm()).toBeGreaterThan(IDLE_RPM);
    expect(car.rpm()).toBeCloseTo(rpmFor(Math.abs(car.getState().forwardSpeed), 1), 0);
  }, 20000);

  it('a vehicle sliding sideways reads idle rpm and stays in gear 1', async () => {
    world = createPhysicsWorld();
    const car = new Vehicle(world, PLACEHOLDER_CAR, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step(car, world, IDLE);
    car.body.setLinvel({ x: 20, y: car.body.linvel().y, z: 0 }, true);
    step(car, world, IDLE);
    expect(car.getState().forwardSpeed).toBeCloseTo(0, 1);
    expect(car.gear()).toBe(1);
    expect(car.rpm()).toBeCloseTo(IDLE_RPM, 0);
  }, 20000);

  it('gearbox.ts imports nothing outside src/core (acceptance criterion)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const src = readFileSync(join(root, 'src/physics/gearbox.ts'), 'utf8');
    const specs = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      const resolved = join(root, 'src/physics', spec);
      expect(resolved.startsWith(join(root, 'src/core'))).toBe(true);
    }
  });

  it('upshifts at rpm >= UPSHIFT_RPM and downshifts only at rpm < DOWNSHIFT_RPM', () => {
    const speedFor = (rpm: number, gear: number): number =>
      (rpm * 0.33) / (RATIOS[gear - 1] * 3.4 * (60 / (2 * Math.PI)));
    const gb = new Gearbox();
    gb.update(speedFor(UPSHIFT_RPM - 1, 1));
    expect(gb.gear).toBe(1);
    gb.update(speedFor(UPSHIFT_RPM + 1, 1));
    expect(gb.gear).toBe(2);
    gb.update(speedFor(DOWNSHIFT_RPM + 1, 2));
    expect(gb.gear).toBe(2);
    gb.update(speedFor(DOWNSHIFT_RPM - 1, 2));
    expect(gb.gear).toBe(1);
  });

  it('vehicle gearbox.update is skipped on invalid dt and runs once even for a huge dt', () => {
    world = createPhysicsWorld();
    const car = new Vehicle(world, PLACEHOLDER_CAR, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    for (let i = 0; i < Math.round(1 / FIXED_DT); i++) step(car, world, IDLE);
    car.body.setLinvel({ x: 0, y: car.body.linvel().y, z: -50 }, true);
    car.prePhysicsStep(0);
    expect(car.gear()).toBe(1);
    car.prePhysicsStep(Number.NaN);
    expect(car.gear()).toBe(1);
    car.prePhysicsStep(-1);
    expect(car.gear()).toBe(1);
    car.prePhysicsStep(1);
    expect(car.gear()).toBe(2);
  }, 20000);

  it('the limiter also cuts drive while reversing in gear 1', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    const vCut = (LIMITER_RPM * 0.33) / (RATIOS[0] * 3.4 * (60 / (2 * Math.PI)));
    expect(gb.driveScale(-(vCut - 0.1))).toBe(1);
    expect(gb.driveScale(-(vCut + 0.1))).toBe(0);
  });
});

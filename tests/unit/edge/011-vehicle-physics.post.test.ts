import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR, type VehicleConfig } from '../../../src/physics/vehicleConfig';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

function isFiniteNum(x: number): boolean {
  return Number.isFinite(x);
}

describe('011 vehicle physics post-code gaps', () => {
  const worlds: World[] = [];
  let vehicle: Vehicle | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    vehicle = null;
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  function make(overrides: Partial<VehicleConfig> = {}): Vehicle {
    const world = createPhysicsWorld();
    worlds.push(world);
    const cfg: VehicleConfig = { ...PLACEHOLDER_CAR, ...overrides };
    vehicle = new Vehicle(world, cfg, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
    return vehicle;
  }

  function worldOf(v: Vehicle): World {
    const w = worlds[worlds.length - 1];
    // v was the last vehicle made: its body lives in the last created world.
    expect(v).toBe(vehicle);
    return w;
  }

  function step(v: Vehicle, w: World, inp: DriverInput): void {
    v.setInput(inp);
    v.prePhysicsStep(FIXED_DT);
    w.step();
  }

  function run(v: Vehicle, w: World, seconds: number, inp: DriverInput): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) step(v, w, inp);
  }

  function accelerateUntil(v: Vehicle, w: World, target: number, abortS: number): number {
    const maxSteps = Math.round(abortS / FIXED_DT);
    const inp = input(1);
    const out: VehicleState = v.getState();
    for (let i = 0; i < maxSteps; i++) {
      step(v, w, inp);
      if (v.getState(out).forwardSpeed >= target) return (i + 1) * FIXED_DT;
    }
    return NaN;
  }

  it('POST1: prePhysicsStep never advances the world; motion only happens on the caller step', () => {
    const v = make();
    const w = worldOf(v);
    run(v, w, 1, input(0));
    const t0 = v.body.translation();
    const x0 = t0.x;
    const y0 = t0.y;
    const z0 = t0.z;
    v.setInput(input(1));
    for (let i = 0; i < 5; i++) v.prePhysicsStep(FIXED_DT);
    const t1 = v.body.translation();
    expect(t1.x).toBeCloseTo(x0, 9);
    expect(t1.y).toBeCloseTo(y0, 9);
    expect(t1.z).toBeCloseTo(z0, 9);
    w.step();
    const z2 = v.body.translation().z;
    expect(z2).toBeLessThan(z0);
  }, 20000);

  it('POST2: getState() without out returns a freshly allocated state each call', () => {
    const v = make();
    const a = v.getState();
    const b = v.getState();
    expect(a).not.toBe(b);
    expect(a.position).not.toBe(b.position);
    expect(a.rotation).not.toBe(b.rotation);
    expect(a.wheels).not.toBe(b.wheels);
    expect(a.wheels[0]).not.toBe(b.wheels[0]);
    expect(a.wheels.length).toBe(4);
    expect(a.position.z).toBeCloseTo(b.position.z, 9);
  }, 20000);

  it('POST3: brake impulse scales with config.brakeMax (brakeMax=0 cannot brake)', () => {
    const v = make({ brakeMax: 0 });
    const w = worldOf(v);
    expect(accelerateUntil(v, w, 20, 8)).toBeGreaterThanOrEqual(0);
    const v0 = v.getState().forwardSpeed;
    run(v, w, 1, input(0, 1));
    const v1 = v.getState().forwardSpeed;
    expect(v0 - v1).toBeLessThan(3);
  }, 20000);

  it('POST4: low-speed drive force caps at config.maxDriveForceN, slowing 0-100 far below the default band', () => {
    const v = make({ maxDriveForceN: 2000 });
    const w = worldOf(v);
    const elapsed = accelerateUntil(v, w, 27.78, 20);
    expect(elapsed).toBeGreaterThanOrEqual(6);
    expect(elapsed).toBeLessThanOrEqual(16);
  }, 20000);

  it('POST5: top speed scales with config.enginePowerW (quarter power lands well under the default 55-66 band)', () => {
    const v = make({ enginePowerW: 32500 });
    const w = worldOf(v);
    run(v, w, 30, input(1));
    const fs = v.getState().forwardSpeed;
    expect(fs).toBeGreaterThan(30);
    expect(fs).toBeLessThan(50);
  }, 20000);

  it('POST6: coast-down deceleration comes from config.dragAreaCdA (CdA=0 coasts almost free)', () => {
    const a = make();
    const wa = worldOf(a);
    const b = make({ dragAreaCdA: 0 });
    const wb = worldOf(b);
    expect(accelerateUntil(a, wa, 45, 30)).toBeGreaterThanOrEqual(0);
    expect(accelerateUntil(b, wb, 45, 30)).toBeGreaterThanOrEqual(0);
    const sa = a.getState();
    const sb = b.getState();
    const va0 = sa.forwardSpeed;
    const vb0 = sb.forwardSpeed;
    run(a, wa, 5, input(0));
    run(b, wb, 5, input(0));
    const decelA = va0 - a.getState().forwardSpeed;
    const decelB = vb0 - b.getState().forwardSpeed;
    expect(decelA).toBeGreaterThan(5);
    expect(decelB).toBeLessThan(decelA - 4);
  }, 20000);

  it('POST7: a large dt is not special-cased: state stays finite and normal stepping resumes', () => {
    const v = make();
    const w = worldOf(v);
    run(v, w, 10, input(1));
    v.setInput(input(1));
    v.prePhysicsStep(FIXED_DT * 50);
    const s = v.getState();
    expect(isFiniteNum(s.position.x) && isFiniteNum(s.position.y) && isFiniteNum(s.position.z)).toBe(true);
    expect(isFiniteNum(s.forwardSpeed)).toBe(true);
    for (const wheel of s.wheels) {
      expect(isFiniteNum(wheel.position.x)).toBe(true);
      expect(isFiniteNum(wheel.position.y)).toBe(true);
      expect(isFiniteNum(wheel.position.z)).toBe(true);
      expect(isFiniteNum(wheel.rotation)).toBe(true);
    }
    run(v, w, 0.5, input(1));
    expect(v.getState().forwardSpeed).toBeGreaterThan(20);
  }, 20000);
});

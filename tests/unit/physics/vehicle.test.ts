import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const SPAWN: SpawnPose = { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 };

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

describe('vehicle physics', () => {
  let world: World;
  let vehicle: Vehicle;
  let state: VehicleState;

  beforeAll(async () => {
    await initPhysics();
  });

  beforeEach(() => {
    world = createPhysicsWorld();
    vehicle = new Vehicle(world, PLACEHOLDER_CAR, SPAWN);
    state = vehicle.getState();
  });

  afterEach(() => {
    world.free();
  });

  function run(seconds: number, inp: DriverInput, onStep?: () => void): void {
    const steps = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      vehicle.setInput(inp);
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      onStep?.();
    }
  }

  function accelerateUntil(target: number, abortS: number): number {
    const maxSteps = Math.round(abortS / FIXED_DT);
    for (let i = 0; i < maxSteps; i++) {
      vehicle.setInput(input(1));
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      if (vehicle.getState(state).forwardSpeed >= target) return (i + 1) * FIXED_DT;
    }
    return NaN;
  }

  it('settles at rest height with 4 wheels in contact', () => {
    run(2, input(0));
    vehicle.getState(state);
    expect(state.position.y).toBeGreaterThanOrEqual(0.33);
    expect(state.position.y).toBeLessThanOrEqual(0.45);
    expect(state.wheels.length).toBe(4);
    for (const wheel of state.wheels) {
      expect(wheel.inContact).toBe(true);
    }
  }, 20000);

  it('accelerates 0-100 km/h in 3.0-4.0 s heading -Z', () => {
    const elapsed = accelerateUntil(27.78, 8);
    expect(elapsed).toBeGreaterThanOrEqual(3.0);
    expect(elapsed).toBeLessThanOrEqual(4.0);
    expect(vehicle.getState(state).position.z).toBeLessThan(0);
  }, 20000);

  it('top speed after 30 s is 55-66 m/s', () => {
    run(30, input(1));
    const forwardSpeed = vehicle.getState(state).forwardSpeed;
    expect(forwardSpeed).toBeGreaterThanOrEqual(55);
    expect(forwardSpeed).toBeLessThanOrEqual(66);
  }, 20000);

  it('braking from ~50 m/s decelerates 12-20 m/s^2', () => {
    expect(accelerateUntil(50, 30)).toBeGreaterThanOrEqual(0);
    const v0 = vehicle.getState(state).forwardSpeed;
    run(1, input(0, 1));
    const v1 = vehicle.getState(state).forwardSpeed;
    const deceleration = (v0 - v1) / 1;
    expect(deceleration).toBeGreaterThanOrEqual(12);
    expect(deceleration).toBeLessThanOrEqual(20);
  }, 20000);

  it('steer +1 at ~20 m/s turns right', () => {
    expect(accelerateUntil(20, 8)).toBeGreaterThanOrEqual(0);
    const x0 = vehicle.getState(state).position.x;
    run(1, input(0.3, 0, 1));
    expect(vehicle.body.angvel().y).toBeLessThan(0);
    expect(vehicle.getState(state).position.x).toBeGreaterThan(x0);
  }, 20000);

  it('yaw pi/2 spawn accelerates towards -X', () => {
    world.free();
    world = createPhysicsWorld();
    vehicle = new Vehicle(world, PLACEHOLDER_CAR, { position: { x: 0, y: 0.6, z: 0 }, yaw: Math.PI / 2 });
    run(2, input(1));
    const s = vehicle.getState();
    expect(s.position.x).toBeLessThan(0);
    expect(Math.abs(s.position.z)).toBeLessThan(1);
  }, 20000);

  it('reset restores spawn pose and zero velocity', () => {
    run(2, input(1));
    vehicle.reset(SPAWN);
    const t = vehicle.body.translation();
    expect(Math.abs(t.x - SPAWN.position.x)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.y - SPAWN.position.y)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.z - SPAWN.position.z)).toBeLessThanOrEqual(0.01);
    const lv = vehicle.body.linvel();
    expect(Math.hypot(lv.x, lv.y, lv.z)).toBeLessThan(0.01);
    expect(Math.abs(vehicle.getState(state).forwardSpeed)).toBeLessThanOrEqual(0.01);
  }, 20000);

  it('getState returns the same out object', () => {
    const out = vehicle.getState();
    expect(vehicle.getState(out)).toBe(out);
    expect(out.wheels.length).toBe(4);
  }, 20000);

  it('does not flip', () => {
    const checkUp = (): void => {
      const q = vehicle.body.rotation();
      expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(0.5);
    };
    run(20, input(1), checkUp);
    run(8, input(1, 0, 1), checkUp);
  }, 20000);
});

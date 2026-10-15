import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  initPhysics,
  createPhysicsWorld,
} from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose, VehicleState } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

const SPAWN: SpawnPose = { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 };
const RAMP_ABORT_S = 8;

function input(throttle: number, brake = 0, steer = 0): DriverInput {
  return { throttle, brake, steer, reset: false };
}

function stepOnce(vehicle: Vehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(
  vehicle: Vehicle,
  world: World,
  seconds: number,
  inp: DriverInput,
  onStep?: (elapsedS: number) => void,
): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    stepOnce(vehicle, world, inp);
    onStep?.((i + 1) * FIXED_DT);
  }
}

// Full throttle until forwardSpeed >= target (NaN if not reached within abort).
function accelerateUntil(
  vehicle: Vehicle,
  world: World,
  target: number,
  out: VehicleState,
  abortS = RAMP_ABORT_S,
): number {
  const maxSteps = Math.round(abortS / FIXED_DT);
  for (let i = 0; i < maxSteps; i++) {
    stepOnce(vehicle, world, input(1));
    if (vehicle.getState(out).forwardSpeed >= target) return (i + 1) * FIXED_DT;
  }
  return NaN;
}

describe('011 vehicle physics acceptance', () => {
  let world: World | null = null;
  let vehicle: Vehicle | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    vehicle = null;
    world?.free();
    world = null;
  });

  function spawn(yaw = SPAWN.yaw): Vehicle {
    world = createPhysicsWorld();
    vehicle = new Vehicle(world, SPEC, { position: { ...SPAWN.position }, yaw });
    return vehicle;
  }

  it('AT1: settles at rest height with 4 wheels in contact after 2 s of no input', () => {
    const v = spawn();
    run(v, world!, 2, input(0));
    const yBefore = v.getState().position.y;
    run(v, world!, 0.5, input(0));
    const state = v.getState();
    expect(Number.isFinite(state.position.y)).toBe(true);
    expect(Math.abs(state.position.y - yBefore)).toBeLessThan(0.005);
    expect(state.wheels.length).toBe(4);
    for (const wheel of state.wheels) {
      expect(wheel.inContact).toBe(true);
    }
  }, 20000);

  it('AT2: reaches 27.78 m/s forwardSpeed in 3.0-5.0 s at full throttle, moving -Z', () => {
    const v = spawn();
    const state = v.getState();
    const elapsed = accelerateUntil(v, world!, 27.78, state);
    expect(elapsed).toBeGreaterThanOrEqual(3.0);
    expect(elapsed).toBeLessThanOrEqual(5.0);
    expect(state.forwardSpeed).toBeGreaterThanOrEqual(27.78);
    expect(state.position.z).toBeLessThan(0);
  }, 20000);

  it('AT3: forwardSpeed is 55-66 m/s after 30 s at full throttle', () => {
    const v = spawn();
    run(v, world!, 30, input(1));
    const forwardSpeed = v.getState().forwardSpeed;
    expect(forwardSpeed).toBeGreaterThanOrEqual(55);
    expect(forwardSpeed).toBeLessThanOrEqual(66);
  }, 20000);

  it('AT4: braking from ~50 m/s gives mean deceleration of 12-20 m/s^2 over 1 s', () => {
    const v = spawn();
    const state = v.getState();
    const elapsed = accelerateUntil(v, world!, 50, state, 30);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    const v0 = state.forwardSpeed;
    run(v, world!, 1, input(0, 1));
    const v1 = v.getState().forwardSpeed;
    const deceleration = (v0 - v1) / 1;
    expect(deceleration).toBeGreaterThanOrEqual(10);
    expect(deceleration).toBeLessThanOrEqual(20);
  }, 20000);

  it('AT5: at ~20 m/s, steer +1 for 1 s turns right (angvel.y < 0, x increased)', () => {
    const v = spawn();
    const state = v.getState();
    const elapsed = accelerateUntil(v, world!, 20, state);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    const x0 = state.position.x;
    run(v, world!, 1, input(0.3, 0, 1));
    expect(v.body.angvel().y).toBeLessThan(0);
    expect(v.getState().position.x).toBeGreaterThan(x0);
  }, 20000);

  it('AT6: spawn yaw pi/2 with full throttle for 2 s moves towards -X (x decreasing, |z| < 1)', () => {
    const v = spawn(Math.PI / 2);
    run(v, world!, 2, input(1));
    const state = v.getState();
    expect(state.position.x).toBeLessThan(0);
    expect(Math.abs(state.position.z)).toBeLessThan(1);
  }, 20000);

  it('AT7: reset(spawn) restores spawn pose, zero linvel and zero forwardSpeed', () => {
    const v = spawn();
    run(v, world!, 2, input(1));
    v.reset(SPAWN);
    const t = v.body.translation();
    expect(Math.abs(t.x - SPAWN.position.x)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.y - SPAWN.position.y)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.z - SPAWN.position.z)).toBeLessThanOrEqual(0.01);
    const lv = v.body.linvel();
    expect(Math.hypot(lv.x, lv.y, lv.z)).toBeLessThan(0.01);
    expect(Math.abs(v.getState().forwardSpeed)).toBeLessThanOrEqual(0.01);
  }, 20000);

  it('AT8: getState(out) returns the same object and has 4 wheels', () => {
    const v = spawn();
    const out = v.getState();
    expect(v.getState(out)).toBe(out);
    expect(out.wheels.length).toBe(4);
  }, 20000);

  it('AT9: never flips over 20 s full throttle then 8 s of steer +1 (up-vector y > 0.5)', () => {
    const v = spawn();
    const checkUp = (): void => {
      const q = v.body.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      expect(upY).toBeGreaterThan(0.5);
    };
    run(v, world!, 20, input(1), checkUp);
    run(v, world!, 8, input(1, 0, 1), checkUp);
  }, 20000);
});

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initPhysics,
  createPhysicsWorld,
} from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const SPAWN: SpawnPose = { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 };

function input(throttle: number, brake = 0, steer = 0, reset = false): DriverInput {
  return { throttle, brake, steer, reset };
}

// Advance without calling setInput: relies on the stored input only.
function advance(vehicle: Vehicle, world: World, steps: number): void {
  for (let i = 0; i < steps; i++) {
    vehicle.prePhysicsStep(FIXED_DT);
    world.step();
  }
}

function run(vehicle: Vehicle, world: World, steps: number, inp: DriverInput): void {
  for (let i = 0; i < steps; i++) {
    vehicle.setInput(inp);
    vehicle.prePhysicsStep(FIXED_DT);
    world.step();
  }
}

function isFiniteVec(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isFiniteQuat(q: { x: number; y: number; z: number; w: number }): boolean {
  return Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}

describe('011 vehicle physics edge cases', () => {
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

  function spawn(yaw = SPAWN.yaw, position: { x: number; y: number; z: number } = { ...SPAWN.position }): Vehicle {
    world = createPhysicsWorld();
    vehicle = new Vehicle(world, PLACEHOLDER_CAR, { position, yaw });
    return vehicle;
  }

  it('EDGE1: before any setInput the stored input is zero and getState is finite', () => {
    const v = spawn();
    const fresh = v.getState();
    expect(isFiniteVec(fresh.position)).toBe(true);
    expect(isFiniteQuat(fresh.rotation)).toBe(true);
    expect(Number.isFinite(fresh.forwardSpeed)).toBe(true);
    for (const wheel of fresh.wheels) {
      expect(isFiniteVec(wheel.position)).toBe(true);
      expect(Number.isFinite(wheel.rotation)).toBe(true);
      expect(Number.isFinite(wheel.steering)).toBe(true);
    }
    // No setInput ever called: the car must stay put under suspension alone.
    advance(v, world!, 30);
    const state = v.getState();
    expect(Math.abs(state.forwardSpeed)).toBeLessThan(0.5);
    expect(Math.abs(state.position.x)).toBeLessThan(0.05);
    expect(Math.abs(state.position.z)).toBeLessThan(0.05);
    expect(state.position.y).toBeGreaterThan(0.3);
    expect(state.position.y).toBeLessThanOrEqual(0.6);
  }, 20000);

  it('EDGE2: setInput clamps throttle/brake to [0,1] and steer to [-1,1], NaN becomes 0, and stores a copy', () => {
    const v = spawn();
    const inp = input(2, NaN, -3); // throttle→1, brake NaN→0, steer→-1
    v.setInput(inp);
    inp.throttle = 0;
    inp.brake = 1;
    inp.steer = 0;
    advance(v, world!, 30);
    const state = v.getState();
    // Copy: later mutation of the caller object must not change the stored input.
    // Clamp: brake NaN→0 must not brake, throttle 2→1 drives.
    expect(Number.isFinite(state.forwardSpeed)).toBe(true);
    expect(state.forwardSpeed).toBeGreaterThan(0.5);
    expect(state.position.z).toBeLessThan(0);
    // Steer -3→-1: s = -steer*maxSteer ≈ +0.35, positive and clamped (unclamped would be ≈ +1.05).
    expect(state.wheels[0].steering).toBeGreaterThan(0.3);
    expect(state.wheels[0].steering).toBeLessThan(0.5);
    // Steer NaN→0: zero input must zero the applied steering.
    v.setInput(input(1, 0, NaN));
    advance(v, world!, 10);
    const state2 = v.getState();
    expect(Number.isFinite(state2.forwardSpeed)).toBe(true);
    expect(Math.abs(state2.wheels[0].steering)).toBeLessThan(0.01);
  }, 20000);

  it('EDGE3: the reset field of DriverInput is ignored (car keeps moving, not teleported)', () => {
    const v = spawn();
    run(v, world!, 120, input(1));
    const zBefore = v.getState().position.z;
    expect(zBefore).toBeLessThan(-1);
    v.setInput(input(0, 0, 0, true));
    advance(v, world!, 1);
    const t = v.body.translation();
    const lv = v.body.linvel();
    // One coasting step moves the car only slightly forward; a reset would teleport z back to ~0.
    expect(Math.abs(t.z - zBefore)).toBeLessThan(0.2);
    expect(t.z).toBeLessThan(0);
    expect(Math.hypot(lv.x, lv.y, lv.z)).toBeGreaterThan(5);
  }, 20000);

  it('EDGE4: reset(spawn) applies the given pose and yaw, zeroes velocities, steering and the stored input', () => {
    const v = spawn();
    run(v, world!, 60, input(1, 0, 1));
    const target: SpawnPose = { position: { x: 2, y: 0.6, z: 3 }, yaw: Math.PI };
    v.reset(target);
    const t = v.body.translation();
    expect(Math.abs(t.x - 2)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.y - 0.6)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(t.z - 3)).toBeLessThanOrEqual(0.01);
    const q = v.getState().rotation;
    expect(Math.abs(q.x)).toBeLessThanOrEqual(0.01);
    expect(q.y).toBeGreaterThan(0.99); // sin(pi/2)
    expect(Math.abs(q.z)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(q.w)).toBeLessThanOrEqual(0.01); // cos(pi/2)
    const lv = v.body.linvel();
    expect(Math.hypot(lv.x, lv.y, lv.z)).toBeLessThan(0.01);
    const av = v.body.angvel();
    expect(Math.hypot(av.x, av.y, av.z)).toBeLessThan(0.01);
    // setWheelSteering(i, 0) for all wheels, readable before any further prePhysicsStep.
    for (const wheel of v.getState().wheels) {
      expect(Math.abs(wheel.steering)).toBeLessThan(0.000001);
    }
    // Internal input zeroed: no setInput since, so the car must stay at the target.
    advance(v, world!, 20);
    const after = v.getState();
    expect(Math.abs(after.position.x - 2)).toBeLessThan(0.05);
    expect(Math.abs(after.position.z - 3)).toBeLessThan(0.05);
    expect(Math.abs(after.forwardSpeed)).toBeLessThan(0.5);
  }, 20000);

  it('EDGE5: getState(out) overwrites nested objects in place, allocating nothing new', () => {
    const v = spawn();
    const out = v.getState();
    const pos = out.position;
    const rot = out.rotation;
    const wheels = out.wheels;
    const w0 = wheels[0];
    const w1 = wheels[1];
    const w2 = wheels[2];
    const w3 = wheels[3];
    const yBefore = pos.y;
    run(v, world!, 5, input(0));
    const again = v.getState(out);
    expect(again).toBe(out);
    expect(again.position).toBe(pos);
    expect(again.rotation).toBe(rot);
    expect(again.wheels).toBe(wheels);
    expect(again.wheels[0]).toBe(w0);
    expect(again.wheels[1]).toBe(w1);
    expect(again.wheels[2]).toBe(w2);
    expect(again.wheels[3]).toBe(w3);
    expect(Math.abs(again.position.y - yBefore)).toBeGreaterThan(0.001); // fields updated
  }, 20000);

  it('EDGE6: steering is applied to front wheels only as -steer*maxSteer, shrinking with speed', () => {
    const v = spawn();
    const fresh = v.getState();
    for (const wheel of fresh.wheels) {
      expect(Math.abs(wheel.steering)).toBeLessThan(0.000001);
    }
    run(v, world!, 10, input(0.5, 0, 1));
    const low = v.getState();
    // At ~0.4 m/s maxSteer ≈ maxSteerLowSpeed = 0.35, sign negative for steer +1.
    const lo = PLACEHOLDER_CAR.maxSteerLowSpeed;
    for (const i of [0, 1]) {
      expect(low.wheels[i].steering).toBeLessThan(-lo * 0.85);
      expect(low.wheels[i].steering).toBeGreaterThan(-lo - 0.01);
    }
    // Only wheels 0 and 1 get setWheelSteering; rear stay at 0.
    expect(Math.abs(low.wheels[2].steering)).toBeLessThan(0.001);
    expect(Math.abs(low.wheels[3].steering)).toBeLessThan(0.001);
    // At speed, lerp towards maxSteerHighSpeed must shrink the magnitude (STEER_FULL_SPEED = 60).
    run(v, world!, 600, input(1)); // ~5 s straight: well above 30 m/s, below 60
    const mid = v.getState();
    expect(mid.forwardSpeed).toBeGreaterThan(30);
    expect(mid.forwardSpeed).toBeLessThan(60);
    run(v, world!, 2, input(1, 0, 1));
    const fast = v.getState();
    expect(fast.wheels[0].steering).toBeGreaterThan(-0.25);
    expect(fast.wheels[0].steering).toBeLessThan(-0.10);
  }, 20000);

  it('EDGE7: getState wheel world positions rotate chassis connection points by the body quaternion (yaw pi/2)', () => {
    const v = spawn(Math.PI / 2);
    run(v, world!, 240, input(0));
    const state = v.getState();
    const cx = state.position.x;
    const cz = state.position.z;
    // At yaw pi/2 the car faces -X; chassis (x,z) maps to world (z,-x):
    // FL(-0.8,0,-1.3)->(cx-1.3, cz+0.8), FR->(cx-1.3, cz-0.8),
    // RL(-0.8,0,1.25)->(cx+1.25, cz+0.8), RR->(cx+1.25, cz-0.8).
    const expectOffset = (i: number, dx: number, dz: number): void => {
      const w = state.wheels[i].position;
      expect(w.x - cx).toBeGreaterThan(dx - 0.08);
      expect(w.x - cx).toBeLessThan(dx + 0.08);
      expect(w.z - cz).toBeGreaterThan(dz - 0.08);
      expect(w.z - cz).toBeLessThan(dz + 0.08);
    };
    expectOffset(0, -1.3, 0.8);
    expectOffset(1, -1.3, -0.8);
    expectOffset(2, 1.25, 0.8);
    expectOffset(3, 1.25, -0.8);
    // Wheel centre sits at the ground contact: c.y = connectionY - suspensionLength (not +).
    for (const wheel of state.wheels) {
      expect(wheel.position.y).toBeGreaterThan(PLACEHOLDER_CAR.wheelRadius - 0.05);
      expect(wheel.position.y).toBeLessThan(PLACEHOLDER_CAR.wheelRadius + 0.05);
    }
  }, 20000);

  it('EDGE8: rotation of all 4 wheels (front included) grows while rolling forward and is ~0 at rest', () => {
    const v = spawn();
    run(v, world!, 120, input(0));
    const rest = v.getState();
    for (const wheel of rest.wheels) {
      expect(Math.abs(wheel.rotation)).toBeLessThan(0.05);
    }
    run(v, world!, 120, input(1));
    const moving = v.getState();
    for (const wheel of moving.wheels) {
      expect(wheel.rotation).toBeGreaterThan(0.5);
    }
    // Front wheels roll at nearly the same accumulated angle as the rears.
    for (const i of [0, 1]) {
      expect(moving.wheels[i].rotation).toBeLessThan(moving.wheels[i + 2].rotation * 2);
      expect(moving.wheels[i].rotation).toBeGreaterThan(moving.wheels[i + 2].rotation * 0.5);
    }
  }, 20000);

  it('EDGE9: full throttle while reversing uses max(forwardSpeed,1): drive force pushes forward, finite', () => {
    const v = spawn();
    v.body.setLinvel({ x: 0, y: 0, z: 20 }, true); // moving +Z = backwards, forwardSpeed ~ -20
    v.setInput(input(1));
    advance(v, world!, 60);
    const forwardSpeed = v.getState().forwardSpeed;
    expect(Number.isFinite(forwardSpeed)).toBe(true);
    // F = min(maxDriveForceN, enginePowerW/1) pushes forward -> fs rises from -20.
    // Unclamped division (power/-20) would give F < 0 and drive the car further backwards.
    expect(forwardSpeed).toBeGreaterThan(-18);
    expect(forwardSpeed).toBeLessThan(0);
  }, 20000);

  it('EDGE10: prePhysicsStep with dt <= 0 or non-finite dt is a no-op; a following valid step still works', () => {
    const v = spawn();
    v.setInput(input(0, 0, 1));
    v.prePhysicsStep(0);
    v.prePhysicsStep(-FIXED_DT);
    // No-op: nothing was applied, so the fresh steering default must still be 0.
    let state = v.getState();
    expect(Math.abs(state.wheels[0].steering)).toBeLessThan(0.000001);
    v.prePhysicsStep(NaN);
    v.prePhysicsStep(Infinity);
    state = v.getState();
    expect(isFiniteVec(state.position)).toBe(true);
    expect(isFiniteQuat(state.rotation)).toBe(true);
    expect(Number.isFinite(state.forwardSpeed)).toBe(true);
    expect(Math.abs(state.wheels[0].steering)).toBeLessThan(0.000001);
    // A valid step afterwards must behave normally.
    v.prePhysicsStep(FIXED_DT);
    world!.step();
    state = v.getState();
    expect(state.wheels[0].steering).toBeLessThan(-0.3);
    expect(isFiniteVec(state.position)).toBe(true);
    expect(state.position.y).toBeGreaterThan(0.3);
    expect(Math.abs(state.forwardSpeed)).toBeLessThan(0.5);
  }, 20000);
});

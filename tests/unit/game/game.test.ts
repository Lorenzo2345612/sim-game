import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, VehicleState } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL_THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RESET_INPUT: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true };

function cloneState(state: VehicleState): VehicleState {
  return JSON.parse(JSON.stringify(state)) as VehicleState;
}

function expectStateEquals(actual: VehicleState, expected: VehicleState): void {
  expect(actual.position.x).toBeCloseTo(expected.position.x, 9);
  expect(actual.position.y).toBeCloseTo(expected.position.y, 9);
  expect(actual.position.z).toBeCloseTo(expected.position.z, 9);
  expect(actual.forwardSpeed).toBeCloseTo(expected.forwardSpeed, 9);
  expect(actual.wheels.length).toBe(expected.wheels.length);
  for (let i = 0; i < expected.wheels.length; i++) {
    expect(actual.wheels[i].position.x).toBeCloseTo(expected.wheels[i].position.x, 9);
    expect(actual.wheels[i].position.y).toBeCloseTo(expected.wheels[i].position.y, 9);
    expect(actual.wheels[i].position.z).toBeCloseTo(expected.wheels[i].position.z, 9);
    expect(actual.wheels[i].steering).toBeCloseTo(expected.wheels[i].steering, 9);
    expect(actual.wheels[i].rotation).toBeCloseTo(expected.wheels[i].rotation, 9);
    expect(actual.wheels[i].inContact).toBe(expected.wheels[i].inContact);
  }
}

describe('game core', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('spawnFromTrack positions at centerline[N-5]', () => {
    const n = circleTrack.centerline.length;
    const p = circleTrack.centerline[n - 5];
    const pose = spawnFromTrack(circleTrack);
    expect(pose.position.x).toBeCloseTo(p[0], 9);
    expect(pose.position.z).toBeCloseTo(p[1], 9);
    expect(pose.position.y).toBeCloseTo(0.6, 9);
  });

  it('spawnFromTrack yaw points towards centerline[N-4]', () => {
    const n = circleTrack.centerline.length;
    const p = circleTrack.centerline[n - 5];
    const q = circleTrack.centerline[n - 4];
    const pose = spawnFromTrack(circleTrack);
    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    expect(fx).toBeCloseTo((q[0] - p[0]) / len, 4);
    expect(fz).toBeCloseTo((q[1] - p[1]) / len, 4);
  });

  it('step advances simTime by FIXED_DT', async () => {
    game = await Game.create(circleTrack);
    game.step(IDLE);
    expect(game.simTime).toBeCloseTo(FIXED_DT, 12);
  }, 20000);

  it('full throttle for 240 steps gives forwardSpeed > 5', async () => {
    game = await Game.create(circleTrack);
    for (let i = 0; i < 240; i++) game.step(FULL_THROTTLE);
    expect(game.getCurrentState().forwardSpeed).toBeGreaterThan(5);
  }, 20000);

  it('getPrevState equals the previous current state', async () => {
    game = await Game.create(circleTrack);
    game.step(IDLE);
    const snapshot = cloneState(game.getCurrentState());
    game.step(IDLE);
    expectStateEquals(game.getPrevState(), snapshot);
  }, 20000);

  it('reset input returns the car to spawn and lap 0', async () => {
    game = await Game.create(circleTrack);
    const spawn = spawnFromTrack(circleTrack);
    for (let i = 0; i < 120; i++) game.step(FULL_THROTTLE);
    game.step(RESET_INPUT);
    const pos = game.getCurrentState().position;
    expect(Math.abs(pos.x - spawn.position.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pos.y - spawn.position.y)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pos.z - spawn.position.z)).toBeLessThanOrEqual(0.05);
    expect(game.getLapInfo().lap).toBe(0);
  }, 20000);

  it('drainEvents empties the queue', async () => {
    game = await Game.create(circleTrack);
    const first = game.drainEvents();
    expect(Array.isArray(first)).toBe(true);
    expect(game.drainEvents()).toEqual([]);
  }, 20000);
});

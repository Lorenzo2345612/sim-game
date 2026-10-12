import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { slerpQuat, interpolateVehicleState } from '../../../src/core/interpolation';
import { spawnFromTrack, Game } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { FIXED_DT } from '../../../src/core/constants';
import type {
  DriverInput,
  Quat,
  TrackData,
  VehicleState,
  WheelState,
} from '../../../src/core/types';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL_THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RESET_INPUT: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true };

// AT3 fixture: closed circle r = 200 resampled at ~2 m, index 0 at (200, 0).
function circleTrack(r: number, spacing: number): TrackData {
  const n = Math.round((2 * Math.PI * r) / spacing);
  const centerline: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    centerline.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return {
    id: 'circle-200',
    name: 'Circle 200',
    widthMeters: 12,
    lengthMeters: 2 * Math.PI * r,
    officialLengthMeters: 2 * Math.PI * r,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    source: { dataset: 'fixture', license: 'fixture', url: 'fixture' },
  };
}

function wheel(
  x: number,
  y: number,
  z: number,
  steering: number,
  rotation: number,
  inContact: boolean,
): WheelState {
  return { position: { x, y, z }, steering, rotation, inContact };
}

function expectVec3Close(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }, digits = 12): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

function expectStateEquals(actual: VehicleState, expected: VehicleState): void {
  expectVec3Close(actual.position, expected.position);
  expect(actual.rotation.x).toBeCloseTo(expected.rotation.x, 12);
  expect(actual.rotation.y).toBeCloseTo(expected.rotation.y, 12);
  expect(actual.rotation.z).toBeCloseTo(expected.rotation.z, 12);
  expect(actual.rotation.w).toBeCloseTo(expected.rotation.w, 12);
  expect(actual.forwardSpeed).toBeCloseTo(expected.forwardSpeed, 12);
  expect(actual.wheels.length).toBe(expected.wheels.length);
  for (let i = 0; i < expected.wheels.length; i++) {
    expectVec3Close(actual.wheels[i].position, expected.wheels[i].position);
    expect(actual.wheels[i].steering).toBeCloseTo(expected.wheels[i].steering, 12);
    expect(actual.wheels[i].rotation).toBeCloseTo(expected.wheels[i].rotation, 12);
    expect(actual.wheels[i].inContact).toBe(expected.wheels[i].inContact);
  }
}

describe('017 game core acceptance', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('AT1: interpolateVehicleState gives prev at t=0, curr at t=1 and the midpoint position at t=0.5', () => {
    const prev: VehicleState = {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      forwardSpeed: 4,
      wheels: [
        wheel(0.8, 0.3, -1.4, 0.1, 2.5, true),
        wheel(-0.8, 0.3, -1.4, -0.1, 3.5, true),
        wheel(0.8, 0.3, 1.4, 0.2, 4.5, false),
        wheel(-0.8, 0.3, 1.4, -0.2, 5.5, true),
      ],
    };
    const curr: VehicleState = {
      position: { x: 5, y: 7, z: -2 },
      rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      forwardSpeed: 10,
      wheels: [
        wheel(4.8, 0.4, -2.4, 0.3, 12.5, true),
        wheel(3.2, 0.4, -2.4, -0.3, 13.5, false),
        wheel(4.8, 0.4, 0.4, 0.4, 14.5, true),
        wheel(3.2, 0.4, 0.4, -0.4, 15.5, true),
      ],
    };
    const zero: VehicleState = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 0 },
      forwardSpeed: 0,
      wheels: [wheel(0, 0, 0, 0, 0, false), wheel(0, 0, 0, 0, 0, false), wheel(0, 0, 0, 0, 0, false), wheel(0, 0, 0, 0, 0, false)],
    };

    const at0 = interpolateVehicleState(prev, curr, 0, { ...zero, position: { ...zero.position }, wheels: zero.wheels.map((w) => ({ ...w, position: { ...w.position } })) });
    expect(Math.abs(at0.position.x - prev.position.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at0.position.y - prev.position.y)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at0.position.z - prev.position.z)).toBeLessThanOrEqual(1e-9);

    const at1 = interpolateVehicleState(prev, curr, 1, { ...zero, position: { ...zero.position }, wheels: zero.wheels.map((w) => ({ ...w, position: { ...w.position } })) });
    expect(Math.abs(at1.position.x - curr.position.x)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at1.position.y - curr.position.y)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(at1.position.z - curr.position.z)).toBeLessThanOrEqual(1e-9);

    const atMid = interpolateVehicleState(prev, curr, 0.5, { ...zero, position: { ...zero.position }, wheels: zero.wheels.map((w) => ({ ...w, position: { ...w.position } })) });
    expect(Math.abs(atMid.position.x - (prev.position.x + curr.position.x) / 2)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(atMid.position.y - (prev.position.y + curr.position.y) / 2)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(atMid.position.z - (prev.position.z + curr.position.z) / 2)).toBeLessThanOrEqual(1e-9);
  });

  it('AT2: slerpQuat at t=0.5 between q and -q is normalized and equals a rotation', () => {
    const a: Quat = { x: 0, y: 0.5, z: 0, w: Math.sqrt(3) / 2 }; // 60 deg about Y
    const b: Quat = { x: -a.x, y: -a.y, z: -a.z, w: -a.w };
    const out: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(a, b, 0.5, out);

    const norm = Math.hypot(out.x, out.y, out.z, out.w);
    expect(Math.abs(norm - 1)).toBeLessThanOrEqual(1e-9);

    const sameSign = Math.hypot(out.x - a.x, out.y - a.y, out.z - a.z, out.w - a.w);
    const flipped = Math.hypot(out.x + a.x, out.y + a.y, out.z + a.z, out.w + a.w);
    expect(Math.min(sameSign, flipped)).toBeLessThanOrEqual(1e-9);
  });

  it('AT3: spawnFromTrack places at centerline[N-5] with y 0.6, yaw pointing at centerline[N-4]', () => {
    const track = circleTrack(200, 2);
    const n = track.centerline.length;
    const p = track.centerline[n - 5];
    const q = track.centerline[n - 4];
    const pose = spawnFromTrack(track);

    expect(Math.abs(pose.position.x - p[0])).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(pose.position.z - p[1])).toBeLessThanOrEqual(1e-9);
    expect(pose.position.y).toBeCloseTo(0.6, 12);

    const fx = -Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    const angleError = Math.abs(Math.atan2(fx * (dz / len) - fz * (dx / len), fx * (dx / len) + fz * (dz / len)));
    expect(angleError).toBeLessThan(1e-6);
  });

  it('AT4: one step advances simTime by FIXED_DT', async () => {
    game = await Game.create(circleTrack(200, 2));
    game.step(IDLE);
    expect(Math.abs(game.simTime - FIXED_DT)).toBeLessThanOrEqual(1e-12);
  }, 20000);

  it('AT5: 240 steps at throttle 1 give current forwardSpeed > 5', async () => {
    game = await Game.create(circleTrack(200, 2));
    for (let i = 0; i < 240; i++) game.step(FULL_THROTTLE);
    expect(game.getCurrentState().forwardSpeed).toBeGreaterThan(5);
  }, 20000);

  it('AT6: step with reset returns the car to spawn and lap 0', async () => {
    const track = circleTrack(200, 2);
    game = await Game.create(track);
    const spawn = spawnFromTrack(track);
    for (let i = 0; i < 120; i++) game.step(FULL_THROTTLE);
    game.step(RESET_INPUT);
    const pos = game.getCurrentState().position;
    expect(Math.abs(pos.x - spawn.position.x)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pos.y - spawn.position.y)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(pos.z - spawn.position.z)).toBeLessThanOrEqual(0.05);
    expect(game.getLapInfo().lap).toBe(0);
  }, 20000);

  it('AT7: drainEvents returns a copy that empties the queue, second call returns []', async () => {
    game = await Game.create(circleTrack(200, 2));
    game.step(IDLE);
    const first = game.drainEvents();
    expect(Array.isArray(first)).toBe(true);
    expect(game.drainEvents()).toEqual([]);
  }, 20000);

  it('AT8: getPrevState equals the current state of the previous step', async () => {
    game = await Game.create(circleTrack(200, 2));
    game.step(IDLE);
    const snapshot: VehicleState = JSON.parse(JSON.stringify(game.getCurrentState()));
    game.step(IDLE);
    expectStateEquals(game.getPrevState(), snapshot);
  }, 20000);
});

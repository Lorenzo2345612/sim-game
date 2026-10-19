import { describe, expect, it } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';

const DT = 1 / 120;
const STEER_LIMIT = 0.6;
const THROTTLE_LIMIT = 0.4;

function straightLine(): RacingLine {
  const n = 201;
  const points = new Float64Array(2 * n);
  const offsets = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    points[2 * i] = 0;
    points[2 * i + 1] = -2 * i;
    dist[i] = 2 * i;
  }
  return { offsets, points, dist, length: 2 * (n - 1) };
}

function flatSpeeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function freshOut() {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function obs(extra: Partial<AiObservation> = {}): AiObservation {
  return { x: 0, z: -100, yaw: 0, speed: 20, ...extra };
}

// maxSteerAngle 0.1 makes the pursuit demand far exceed the traffic limit
function driver(): AiDriver {
  return new AiDriver(straightLine(), flatSpeeds(201, 30), { maxSteerAngle: 0.1 });
}

describe('AI traffic caution (task 273)', () => {
  it('without traffic nearby the commands are unchanged', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.throttle).toBe(1);
    expect(out.steer).toBeGreaterThan(STEER_LIMIT);
  });

  it('throttle is limited to 0.4 while a car is alongside or close ahead', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs(), DT, out);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
  });

  it('steer demand above the 0.6 limit is clamped to it on both sides', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    drv.update(obs({ x: 8 }), DT, out);
    expect(out.steer).toBeCloseTo(-STEER_LIMIT, 10);
  });

  it('gentle steer below the limit passes through untouched', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 30));
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -2 }), DT, out);
    expect(out.steer).toBeCloseTo(0.20044, 4);
    expect(out.throttle).toBe(THROTTLE_LIMIT);
  });

  it('in a slide the steer stays unlimited so the car can catch it', () => {
    const drv = driver();
    const out = freshOut();
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.steer).toBe(1);
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.steer).toBe(1);
    expect(out.throttle).toBeLessThanOrEqual(THROTTLE_LIMIT);
  });

  it('releasing the caution restores the unlimited commands', () => {
    const drv = driver();
    const out = freshOut();
    drv.setTrafficNear(true);
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.steer).toBeCloseTo(STEER_LIMIT, 10);
    drv.setTrafficNear(false);
    drv.update(obs({ x: -8 }), DT, out);
    expect(out.steer).toBeGreaterThan(STEER_LIMIT);
    expect(out.throttle).toBe(1);
  });

  it('a follow cap is a speed limit, not scaled again by the difficulty', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 40), { speedScale: 0.86 });
    const out = freshOut();
    drv.setFollowCap(28);
    drv.update(obs({ speed: 28 }), DT, out);
    expect(out.brake).toBeCloseTo(0, 10);
    expect(out.throttle).toBeCloseTo(0, 10);
  });
});

import { describe, expect, it } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';

const DT = 1 / 120;
const SLIP_LIMIT = (6 * Math.PI) / 180;
const YAW_LIMIT = 0.25;

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
  // On the line the steer command is 0, so the yaw-rate error is just yawRate.
  return { x: 0, z: -100, yaw: 0, speed: 20, ...extra };
}

describe('AI stability aid', () => {
  it('without rearSlip/yawRate the commands are unchanged', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs({ x: -2 }), DT, out);
    expect(out.throttle).toBe(1);
    expect(out.steer).toBeCloseTo(0.20044, 4);
  });

  it('throttle is scaled by max(0, 1 - excess/threshold) past 6 degrees of rear slip', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs(), DT, out);
    expect(out.throttle).toBe(1);

    // 9 degrees = 6 degrees limit + 3 degrees excess -> scale 0.5
    drv.update(obs({ rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.throttle).toBeCloseTo(0.5, 10);

    // 12 degrees -> excess equals the threshold -> scale 0
    drv.update(obs({ rearSlip: (12 * Math.PI) / 180 }), DT, out);
    expect(out.throttle).toBe(0);

    // at the limit there is no reduction yet
    drv.update(obs({ rearSlip: SLIP_LIMIT - 1e-9 }), DT, out);
    expect(out.throttle).toBe(1);
  });

  it('throttle is scaled past 0.25 rad/s of yaw-rate error', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs(), DT, out);
    // half the threshold of excess over the limit -> scale 0.5
    drv.update(obs({ yawRate: YAW_LIMIT + YAW_LIMIT / 2 }), DT, out);
    expect(out.throttle).toBeCloseTo(0.5, 10);
    drv.update(obs({ yawRate: -2 * YAW_LIMIT }), DT, out);
    expect(out.throttle).toBe(0);
  });

  it('the steering magnitude cannot grow on an over-limit tick', () => {
    const drv = new AiDriver(straightLine(), flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs({ x: -2 }), DT, out);
    const held = out.steer;
    expect(held).toBeGreaterThan(0);

    // more offset would ask for more lock; the aid holds the previous magnitude
    drv.update(obs({ x: -4, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(out.steer).toBeCloseTo(held, 10);

    // still free to reduce
    drv.update(obs({ x: 0, rearSlip: (9 * Math.PI) / 180 }), DT, out);
    expect(Math.abs(out.steer)).toBeLessThan(Math.abs(held));
  });
});

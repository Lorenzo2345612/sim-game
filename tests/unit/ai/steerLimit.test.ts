import { describe, expect, it } from 'vitest';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { RacingLine } from '../../../src/ai/racingLine';

const DT = 1 / 120;
// VehicleModel steering curve of f4.json; the lock falls from 0.38 to 0.09 rad at 60 m/s.
const LOW = 0.38;
const HIGH = 0.09;
const FULL = 60;
// Pursuit demand of the x = -2 observation below: δ = 0.0701566 rad.
const DELTA = 0.0701566;

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

function speeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function out() {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function obs(x: number, speed: number, yaw = 0): AiObservation {
  return { x, z: -100, yaw, speed };
}

function lockAt(speed: number): number {
  const t = speed > FULL ? 1 : speed / FULL;
  return LOW + (HIGH - LOW) * t;
}

describe('AI steering lock curve', () => {
  it('without a curve the command stays delta / maxSteerAngle', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    const o = out();
    drv.update(obs(-2, 20), DT, o);
    expect(o.steer).toBeCloseTo(DELTA / 0.35, 4);
  });

  it('with a curve the command is the demanded angle over the lock at that speed', () => {
    for (const speed of [20, 30, 60]) {
      // maxSteerAngle 1 makes the reference command the demanded angle in rad
      const ref = new AiDriver(straightLine(), speeds(201, 30), { maxSteerAngle: 1 });
      const drv = new AiDriver(straightLine(), speeds(201, 30));
      drv.setSteerCurve(LOW, HIGH, FULL);
      const r = out();
      const o = out();
      ref.update(obs(-2, speed), DT, r);
      drv.update(obs(-2, speed), DT, o);
      expect(o.steer, `speed ${speed}`).toBeCloseTo(r.steer / lockAt(speed), 4);
    }
  });

  it('the 20 m/s command matches the hand-computed δ / lock', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    drv.setSteerCurve(LOW, HIGH, FULL);
    const o = out();
    drv.update(obs(-2, 20), DT, o);
    expect(o.steer).toBeCloseTo(DELTA / lockAt(20), 4);
  });

  it('the high-speed lock makes the same error demand a much larger command', () => {
    const fixed = new AiDriver(straightLine(), speeds(201, 30));
    const curved = new AiDriver(straightLine(), speeds(201, 30));
    curved.setSteerCurve(LOW, HIGH, FULL);
    const a = out();
    const b = out();
    fixed.update(obs(-2, 20), DT, a);
    curved.update(obs(-2, 20), DT, b);
    expect(b.steer).toBeGreaterThan(a.steer);
  });

  it('the command saturates at ±1 when the demand exceeds the available lock', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    drv.setSteerCurve(LOW, HIGH, FULL);
    const o = out();
    // facing +X at 60 m/s the line is 90° to the left: δ ≈ 0.143 rad > 0.09 rad lock
    drv.update(obs(0, 60, -Math.PI / 2), DT, o);
    expect(o.steer).toBe(-1);
    drv.update(obs(0, 60, Math.PI / 2), DT, o);
    expect(o.steer).toBe(1);
  });

  it('the same demand stays unsaturated under the fixed maxSteerAngle', () => {
    const drv = new AiDriver(straightLine(), speeds(201, 30));
    const o = out();
    drv.update(obs(0, 60, -Math.PI / 2), DT, o);
    expect(Math.abs(o.steer)).toBeLessThan(1);
  });
});

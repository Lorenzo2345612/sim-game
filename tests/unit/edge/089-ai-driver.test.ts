import { describe, expect, it } from 'vitest';
import type { RacingLine } from '../../../src/ai/racingLine';
import { AiDriver, type AiObservation } from '../../../src/ai/aiDriver';
import type { DriverInput } from '../../../src/core/types';

const DT = 1 / 120;

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

function freshOut(): DriverInput {
  return { throttle: 0, brake: 0, steer: 0, reset: false };
}

function obs(x: number, z: number, yaw: number, speed: number): AiObservation {
  return { x, z, yaw, speed };
}

function integrate(drv: AiDriver, car: { x: number; z: number; yaw: number; v: number }, dt: number, out: DriverInput): void {
  drv.update(obs(car.x, car.z, car.yaw, car.v), dt, out);
  car.x += -car.v * Math.sin(car.yaw) * dt;
  car.z += -car.v * Math.cos(car.yaw) * dt;
  car.yaw += (-car.v * Math.tan(out.steer * 0.35) / 2.6) * dt;
  car.v = Math.max(0, car.v + (8 * out.throttle - 12 * out.brake) * dt);
}

describe('089 AI driver edge cases', () => {
  it('EDGE1: at speed 0 the lookahead clamps to minLookahead 8 m', () => {
    // L = clamp(0·0.6, 8, 45) = 8; car 2 m left, target 8 m ahead on the line:
    // ld² = 2² + 8² = 68, δ = atan(2·2.6·(2/√68)/√68) = atan(10.4/68) = 0.151765, steer = /0.35 = 0.433615
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs(-2, -100, 0, 0), DT, out);
    expect(out.steer).toBeCloseTo(0.433615, 5);
  });

  it('EDGE2: at very high speed the lookahead clamps to maxLookahead 45 m', () => {
    // L = clamp(200·0.6, 8, 45) = 45; car 2 m right, target 45 m ahead:
    // ld² = 4 + 2025 = 2029, δ = atan(−10.4/2029) = −0.0051256, steer = −0.0146445
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const out = freshOut();
    drv.update(obs(2, -100, 0, 200), DT, out);
    expect(out.steer).toBeCloseTo(-0.0146445, 6);
  });

  it('EDGE3: steering saturates at ±1 within maxSteerAngle 0.35 rad', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const out = freshOut();
    // target 90° to the right at 12 m: δ = atan(2·2.6·1/12) = 0.40777 rad > 0.35 → clamp +1
    drv.update(obs(0, -100, -Math.PI / 2, 20), DT, out);
    expect(out.steer).toBeCloseTo(1, 10);
    // mirror: target 90° to the left → clamp −1
    drv.update(obs(0, -100, Math.PI / 2, 20), DT, out);
    expect(out.steer).toBeCloseTo(-1, 10);
  });

  it('EDGE4: setSpeedCap overrides the profile target and null clears it', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const out = freshOut();
    // cap 18: err = 18 − 20 = −2 → brake = 0.25·2 = 0.5, throttle 0
    drv.setSpeedCap(18);
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.throttle).toBeCloseTo(0, 10);
    expect(out.brake).toBeCloseTo(0.5, 10);
    // cap 0: err = −20 → brake clamps to 1
    drv.setSpeedCap(0);
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.brake).toBeCloseTo(1, 10);
    // cleared: target 30 again → throttle = 0.5·10 clamps to 1
    drv.setSpeedCap(null);
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.throttle).toBeCloseTo(1, 10);
    expect(out.brake).toBeCloseTo(0, 10);
  });

  it('EDGE5: speed target previews 0.3·speed metres ahead, braking before the slow zone', () => {
    const line = straightLine();
    const speeds = flatSpeeds(201, 30);
    for (let i = 57; i < 201; i++) speeds[i] = 10;
    const drv = new AiDriver(line, speeds);
    const out = freshOut();
    // speed 20: s = 100, preview 6 m → index 53 (dist 106) still fast → throttle 1
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.throttle).toBeCloseTo(1, 10);
    expect(out.brake).toBeCloseTo(0, 10);
    // speed 40: preview 12 m → dist 112 → index 56 (fast) either floored or rounded → err −10 → brake 1
    drv.update(obs(0, -100, 0, 40), DT, out);
    expect(out.brake).toBeCloseTo(1, 10);
    expect(out.throttle).toBeCloseTo(0, 10);
  });

  it('EDGE6: speedScale multiplies the capped target, not each term separately', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30), { speedScale: 0.5 });
    const out = freshOut();
    // no cap: target = 30·0.5 = 15, speed 20 → err −5 → brake = clamp(1.25) = 1
    drv.update(obs(0, -100, 0, 20), DT, out);
    expect(out.brake).toBeCloseTo(1, 10);
    expect(out.throttle).toBeCloseTo(0, 10);
    // cap 25: target = min(30, 25)·0.5 = 12.5, speed 12 → err +0.5 → throttle = 0.25
    // (scaling before the min would give min(15, 25) = 15 → err 3 → throttle 1)
    drv.setSpeedCap(25);
    drv.update(obs(0, -100, 0, 12), DT, out);
    expect(out.throttle).toBeCloseTo(0.25, 10);
    expect(out.brake).toBeCloseTo(0, 10);
  });

  it('EDGE7: dt ≤ 0 skips the offset slew and obs is not mutated', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    drv.setLateralOffset(1);
    const out = freshOut();
    const o = obs(0, -100, 0, 20);
    // mid-slew state; then zero/negative dt must advance nothing: same obs + frozen
    // offset → identical outputs, while a following 0.2 s update must differ
    drv.update(o, 0.2, out);
    drv.update(o, 0, out);
    const s2 = out.steer;
    drv.update(o, 0, out);
    expect(out.steer).toBe(s2);
    drv.update(o, -0.5, out);
    expect(out.steer).toBe(s2);
    drv.update(o, 0.2, out);
    expect(out.steer).not.toBe(s2);
    expect(o.x).toBe(0);
    expect(o.z).toBe(-100);
    expect(o.yaw).toBe(0);
    expect(o.speed).toBe(20);
  });

  it('EDGE8: setLateralOffset retargets mid-slew; the offset keeps slewing toward the new target', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30));
    const car = { x: 0, z: -100, yaw: 0, v: 20 };
    const out = freshOut();
    drv.setLateralOffset(0.5);
    for (let i = 0; i < 3; i++) integrate(drv, car, 0.2, out);
    // 3·0.2·1.5 = 0.9 > 0.5 → slewed offset already at +0.5; car progressing right,
    // bounded by the cumulative 1.5 m/s limit from 0
    expect(car.x).toBeGreaterThan(0);
    expect(car.x).toBeLessThanOrEqual(1.5 * 0.6 + 1e-6);
    drv.setLateralOffset(-1);
    const xAt = car.x;
    for (let i = 0; i < 3; i++) integrate(drv, car, 0.2, out);
    // the new target is not latched: car must move left of where it was
    expect(car.x).toBeLessThan(xAt);
    for (let i = 0; i < 48; i++) integrate(drv, car, 0.2, out);
    // cumulative slew bound from t=0 still holds at t=10.8 s
    expect(Math.abs(car.x)).toBeLessThanOrEqual(1.5 * 10.8 + 1e-6);
    expect(Math.abs(car.x + 1)).toBeLessThanOrEqual(0.2);
  });

  it('EDGE9: after reset(obs) a large teleport behaves like a fresh driver (global search)', () => {
    const line = straightLine();
    const speeds = flatSpeeds(201, 30);
    const start = obs(-2, -100, 0, 20); // nearest index 50
    const tele = obs(-2, -330, 0, 20); // nearest index 165: 115 forward / 86 wrapped, outside ±50
    const fresh = new AiDriver(line, speeds);
    const o1 = freshOut();
    fresh.update(tele, DT, o1);
    const drv = new AiDriver(line, speeds);
    const o2 = freshOut();
    drv.update(start, DT, o2);
    drv.reset(tele);
    drv.update(tele, DT, o2);
    // global projection: nearest index 165, target 12 m ahead → steer = atan(10.4/148)/0.35 = 0.20044
    expect(o1.steer).toBeCloseTo(0.20044, 4);
    expect(o2.steer).toBeCloseTo(o1.steer, 10);
  });

  it('EDGE10: zero lookahead distance gives steer 0, never NaN', () => {
    // params minLookahead 0, lookaheadTime 0 → L = 0 at speed 0; car exactly on a line point
    // → target coincides, ld < 1e-6 → steer must be 0
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(201, 30), { lookaheadTime: 0, minLookahead: 0 });
    const out = freshOut();
    drv.update(obs(0, -100, 0, 0), DT, out);
    expect(out.steer).toBe(0);
    expect(out.steer).toBeCloseTo(0, 10);
    expect(out.reset).toBe(false);
  });
});

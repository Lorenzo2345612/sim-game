import { describe, expect, it } from 'vitest';
import { computeRacingLine, type RacingLine } from '../../../src/ai/racingLine';
import { AiDriver, DEFAULT_AI_PARAMS, type AiObservation } from '../../../src/ai/aiDriver';

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

// Rounded square from 087 AT2: 4 straights of 200 m joined by 90-degree
// right-hand arcs of R 30, 2 m spacing (arcs in 24 steps).
function roundedSquare(): [number, number][] {
  const R = 30;
  const straight = 200;
  const arcSteps = 24;
  const centerline: [number, number][] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  centerline.push([0, 0]);
  for (let corner = 0; corner < 4; corner++) {
    for (let t = 2; t <= straight; t += 2) {
      x += 2 * Math.cos(phi);
      z += 2 * Math.sin(phi);
      centerline.push([x, z]);
    }
    const cx = x - R * Math.sin(phi);
    const cz = z + R * Math.cos(phi);
    const phi0 = phi;
    for (let k = 1; k <= arcSteps; k++) {
      const a = phi0 + (k * Math.PI) / (2 * arcSteps);
      x = cx + R * Math.sin(a);
      z = cz - R * Math.cos(a);
      phi = a;
      if (k === arcSteps && corner === 3) break;
      centerline.push([x, z]);
    }
  }
  return centerline;
}

function flatSpeeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

function freshOut() {
  return { throttle: 0, brake: 0, steer: 0, reset: true };
}

function tangentYaw(line: RacingLine, i: number): number {
  const n = line.points.length / 2;
  const j = (i + 1) % n;
  const dx = line.points[2 * j] - line.points[2 * i];
  const dz = line.points[2 * j + 1] - line.points[2 * i + 1];
  return Math.atan2(-dx, -dz);
}

describe('AiDriver', () => {
  it('DEFAULT_AI_PARAMS matches the spec', () => {
    expect(DEFAULT_AI_PARAMS).toEqual({
      speedScale: 1,
      lookaheadTime: 0.6,
      minLookahead: 8,
      maxLookahead: 45,
      wheelbase: 2.6,
      maxSteerAngle: 0.35,
      kp: 0.5,
      kb: 0.25,
    });
  });

  it('update mutates and returns the same out object with reset false', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    const ret = drv.update({ x: 0, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(ret).toBe(out);
    expect(out.reset).toBe(false);
  });

  it('throttle and brake are never both positive across a speed sweep', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    for (let v = 0; v <= 60; v += 2) {
      drv.update({ x: 0, z: -100, yaw: 0, speed: v }, DT, out);
      expect(out.throttle > 0 && out.brake > 0).toBe(false);
    }
  });

  it('steering sign mirrors the side of the line', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    drv.update({ x: -2, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.steer).toBeCloseTo(0.2004, 3);
    drv.update({ x: 2, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.steer).toBeCloseTo(-0.2004, 3);
  });

  it('lookahead is clamped to min and max', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    // speed 5 -> L = min clamp 8: target (0,-108) from car (-2,-100)
    drv.update({ x: -2, z: -100, yaw: 0, speed: 5 }, DT, out);
    expect(out.steer).toBeCloseTo(0.4336, 3);
    // speed 200 -> L = max clamp 45: target (0,-145)
    drv.update({ x: -2, z: -100, yaw: 0, speed: 200 }, DT, out);
    expect(out.steer).toBeCloseTo(0.01464, 4);
  });

  it('setSpeedCap caps the target speed', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    drv.setSpeedCap(28);
    const out = freshOut();
    drv.update({ x: 0, z: -100, yaw: 0, speed: 29 }, DT, out);
    expect(out.throttle).toBe(0);
    expect(out.brake).toBeCloseTo(0.25, 10);
    drv.setSpeedCap(null);
    drv.update({ x: 0, z: -100, yaw: 0, speed: 29 }, DT, out);
    expect(out.throttle).toBeCloseTo(0.5, 10);
    expect(out.brake).toBe(0);
  });

  it('effective offset slews at 1.5 m/s and dt <= 0 does not slew', () => {
    const line = straightLine();
    const slew = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const base = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    slew.setLateralOffset(3);
    const outA = freshOut();
    const outB = freshOut();
    // dt = 0: offset stays at 0, steering identical to a driver with no offset
    slew.update({ x: 0, z: -100, yaw: 0, speed: 20 }, 0, outA);
    base.update({ x: 0, z: -100, yaw: 0, speed: 20 }, DT, outB);
    expect(outA.steer).toBe(outB.steer);
    // dt = 0.1: offset moved exactly 0.15 m -> target point (0.15, -112)
    slew.update({ x: 0, z: -100, yaw: 0, speed: 20 }, 0.1, outA);
    expect(outA.steer).toBeCloseTo(0.01547, 3);
  });

  it('reset performs a global nearest-point search', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    drv.update({ x: 0, z: -300, yaw: 0, speed: 20 }, DT, out);
    // teleported 200 m back without reset: local search latches onto a far segment
    drv.update({ x: -2, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.steer).toBeLessThan(0.01);
    // reset re-locates globally
    drv.reset({ x: -2, z: -100, yaw: 0, speed: 20 });
    drv.update({ x: -2, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.steer).toBeCloseTo(0.2004, 3);
  });

  it('closed-loop line: reset re-locates on the rounded square', () => {
    const line = computeRacingLine(roundedSquare(), 6, 1);
    const n = line.points.length / 2;
    const drv = new AiDriver(line, flatSpeeds(n, 30));
    const out = freshOut();
    const j = 50;
    const obs: AiObservation = {
      x: line.points[2 * j],
      z: line.points[2 * j + 1],
      yaw: tangentYaw(line, j),
      speed: 20,
    };
    drv.reset(obs);
    drv.update(obs, DT, out);
    expect(Math.abs(out.steer)).toBeLessThan(0.05);
    // teleport halfway around the loop, reset finds it again
    const k = (j + Math.floor(n / 2)) % n;
    const obs2: AiObservation = {
      x: line.points[2 * k],
      z: line.points[2 * k + 1],
      yaw: tangentYaw(line, k),
      speed: 20,
    };
    drv.reset(obs2);
    drv.update(obs2, DT, out);
    expect(Math.abs(out.steer)).toBeLessThan(0.05);
  });

  it('update never mutates the observation or the line', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    const obs: AiObservation = { x: -2, z: -100, yaw: 0, speed: 20 };
    const obsCopy = { ...obs };
    const pts = Float64Array.from(line.points);
    const offs = Float64Array.from(line.offsets);
    const dist = Float64Array.from(line.dist);
    drv.update(obs, DT, out);
    expect(obs).toEqual(obsCopy);
    expect(Float64Array.from(line.points)).toEqual(pts);
    expect(Float64Array.from(line.offsets)).toEqual(offs);
    expect(Float64Array.from(line.dist)).toEqual(dist);
  });
});

import { describe, expect, it } from 'vitest';
import { computeRacingLine, type RacingLine } from '../../../src/ai/racingLine';
import { speedProfile, type CarLimits } from '../../../src/ai/speedProfile';
import { AiDriver } from '../../../src/ai/aiDriver';
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

// Turtle from 087 AT2: 4 straights of 200 m joined by 90-degree right-hand
// arcs of R 30, 2 m spacing (arcs in 24 steps).
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

const LIMITS: CarLimits = {
  muLat: 1.5, muLong: 1.5, aeroK: 0, dragK: 0, powerPerMass: 1e6, vMax: 100,
};

function flatSpeeds(n: number, v: number): Float64Array {
  return new Float64Array(n).fill(v);
}

interface Car { x: number; z: number; yaw: number; v: number }

// Kinematic bicycle test model from the spec rows: x' = -v·sin(yaw),
// z' = -v·cos(yaw), yaw' = -v·tan(steer·0.35)/2.6, v' = 8·throttle - 12·brake (>= 0).
function integrate(drv: AiDriver, car: Car, out: DriverInput): void {
  drv.update({ x: car.x, z: car.z, yaw: car.yaw, speed: car.v }, DT, out);
  const dxm = -car.v * Math.sin(car.yaw);
  const dzm = -car.v * Math.cos(car.yaw);
  car.x += dxm * DT;
  car.z += dzm * DT;
  car.yaw += (-car.v * Math.tan(out.steer * 0.35) / 2.6) * DT;
  car.v = Math.max(0, car.v + (8 * out.throttle - 12 * out.brake) * DT);
}

function freshOut(): DriverInput {
  return { throttle: 0, brake: 0, steer: 0, reset: false };
}

describe('089 AI driver acceptance', () => {
  it('AT1: car on a straight line heading along it steers zero', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    drv.update({ x: 0, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(Math.abs(out.steer)).toBeLessThanOrEqual(1e-6);
  });

  it('AT2: car 2 m left of the straight steers right by atan(2·2.6·(2/√148)/√148)/0.35', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    drv.update({ x: -2, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.steer).toBeCloseTo(0.2004, 2);
  });

  it('AT3: target 30 gives throttle 1 / brake 0 at speed 20, and throttle 0 / brake 0.5 at speed 32', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    const out = freshOut();
    drv.update({ x: 0, z: -100, yaw: 0, speed: 20 }, DT, out);
    expect(out.throttle).toBeCloseTo(1, 10);
    expect(out.brake).toBeCloseTo(0, 10);
    drv.update({ x: 0, z: -100, yaw: 0, speed: 32 }, DT, out);
    expect(out.throttle).toBeCloseTo(0, 10);
    expect(out.brake).toBeCloseTo(0.5, 10);
  });

  it('AT4: bicycle model completes one lap of the rounded square within 1.0 m of the line', () => {
    const line = computeRacingLine(roundedSquare(), 6, 1);
    const speeds = speedProfile(line, LIMITS);
    const n = line.points.length / 2;
    const drv = new AiDriver(line, speeds, { speedScale: 0.9 });
    const dxT = line.points[2] - line.points[0];
    const dzT = line.points[3] - line.points[1];
    const car: Car = { x: line.points[0], z: line.points[1], yaw: Math.atan2(-dxT, -dzT), v: 20 };
    const out = freshOut();
    let progress = 0;
    let maxLat = 0;
    let completed = false;
    for (let step = 0; step < 120 * 120; step++) {
      const px = car.x;
      const pz = car.z;
      integrate(drv, car, out);
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = (line.points[2 * i] - car.x) ** 2 + (line.points[2 * i + 1] - car.z) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const j = (bi + 1) % n;
      let tx = line.points[2 * j] - line.points[2 * bi];
      let tz = line.points[2 * j + 1] - line.points[2 * bi + 1];
      const tl = Math.hypot(tx, tz);
      tx /= tl;
      tz /= tl;
      // progress along the line tangent and lateral error on its right normal (-tz, tx)
      progress += (car.x - px) * tx + (car.z - pz) * tz;
      const lat = Math.abs((car.x - line.points[2 * bi]) * -tz + (car.z - line.points[2 * bi + 1]) * tx);
      if (lat > maxLat) maxLat = lat;
      if (progress >= line.length) {
        completed = true;
        break;
      }
    }
    expect(completed).toBe(true);
    expect(maxLat).toBeLessThan(1.0);
  });

  it('AT5: setLateralOffset(3) settles 3 m right of the straight within the 1.5 m/s slew', () => {
    const line = straightLine();
    const drv = new AiDriver(line, flatSpeeds(line.points.length / 2, 30));
    drv.setLateralOffset(3);
    const car: Car = { x: 0, z: -100, yaw: 0, v: 20 };
    const out = freshOut();
    // the internal offset slews at 1.5 m/s; observed as the cumulative bound on the
    // car's lateral offset from the line (instantaneous tracking can briefly exceed it)
    let slewViolation = false;
    for (let step = 0; step < 480; step++) {
      integrate(drv, car, out);
      const t = (step + 1) * DT;
      if (Math.abs(car.x) > 1.5 * t + 1e-6) slewViolation = true;
    }
    expect(slewViolation).toBe(false);
    expect(Math.abs(car.x - 3)).toBeLessThanOrEqual(0.2);
  });
});

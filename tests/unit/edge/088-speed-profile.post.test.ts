import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRacingLine, type RacingLine } from '../../../src/ai/racingLine';
import {
  carLimitsFromSpec,
  cornerSpeed,
  speedProfile,
  type CarLimits,
} from '../../../src/ai/speedProfile';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const G = 9.81;

function limits(over: Partial<CarLimits>): CarLimits {
  return { muLat: 1.5, muLong: 1.5, aeroK: 0, dragK: 0, powerPerMass: 1e6, vMax: 100, ...over };
}

function lineFrom(points: number[]): RacingLine {
  const pts = Float64Array.from(points);
  const n = pts.length / 2;
  const dist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    dist[i] = acc;
  }
  acc += Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1]);
  return { offsets: new Float64Array(n), points: pts, dist, length: acc };
}

function circle(n: number, r: number): RacingLine {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push(r * Math.cos(a), r * Math.sin(a));
  }
  return lineFrom(pts);
}

function aG(v: number, kappa: number, lim: CarLimits): number {
  const normal = G + lim.aeroK * v * v;
  const used = (v * v * kappa) / (lim.muLat * normal);
  return lim.muLong * normal * Math.sqrt(Math.max(0, 1 - used * used));
}

function forwardFrom(v: number, kappa: number, ds: number, lim: CarLimits): number {
  const a = Math.min(aG(v, kappa, lim), lim.powerPerMass / Math.max(v, 1)) - lim.dragK * v * v;
  return Math.sqrt(Math.max(0, v * v + 2 * a * ds));
}

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

describe('088 speedProfile post-implementation gaps', () => {
  it('POST1: on an aero circle the a_g clamp holds the profile below cornerSpeed and the forward recurrence is exact', () => {
    const lim = limits({ aeroK: 0.003, dragK: 0.0005 });
    const line = circle(120, 100);
    const n = 120;
    const cap = cornerSpeed(1 / 100, lim);
    expect(cap).toBeLessThan(lim.vMax);
    const profile = speedProfile(line, lim);
    const ds = Math.hypot(
      line.points[2] - line.points[0],
      line.points[3] - line.points[1],
    );
    for (let i = 0; i < n; i++) {
      const v = profile[i];
      expect(Number.isFinite(v)).toBe(true);
      // At cornerSpeed the friction circle is fully used, so a_g clamps to 0 and drag
      // forces the profile below the cap; it must not collapse to ~0 either.
      expect(v).toBeLessThan(cap - 1e-3);
      expect(v).toBeGreaterThan(40);
      const j = (i + 1) % n;
      const pred = Math.min(cap, forwardFrom(v, 1 / 100, ds, lim));
      expect(Math.abs(profile[j] - pred)).toBeLessThanOrEqual(1e-9 * pred + 1e-12);
    }
  });

  it('POST2: raising powerPerMass never lowers any point of the profile and raises the straight top speed', () => {
    const line = computeRacingLine(roundedSquare(), 6, 1);
    const base: Partial<CarLimits> = { muLat: 1.6, muLong: 1.6, aeroK: 0.002, dragK: 0.0004, vMax: 80 };
    const p0 = speedProfile(line, limits({ ...base, powerPerMass: 0 }));
    const p1 = speedProfile(line, limits({ ...base, powerPerMass: 100 }));
    const p2 = speedProfile(line, limits({ ...base, powerPerMass: 400 }));
    for (let i = 0; i < p0.length; i++) {
      expect(p1[i]).toBeGreaterThanOrEqual(p0[i] - 1e-12);
      expect(p2[i]).toBeGreaterThanOrEqual(p1[i] - 1e-12);
    }
    const maxOf = (p: Float64Array): number => Math.max(...Array.from(p));
    expect(maxOf(p2)).toBeGreaterThan(maxOf(p1));
  });

  it('POST3: a three-point closed line yields exactly the corner speed of its circumcircle', () => {
    const lim = limits({});
    const profile = speedProfile(circle(3, 105), lim);
    expect(profile.length).toBe(3);
    const cap = cornerSpeed(1 / 105, lim);
    for (const v of profile) {
      expect(v).toBeLessThanOrEqual(cap);
      expect(cap - v).toBeLessThan(1e-6 * cap);
    }
  });

  it('POST4: duplicate consecutive points (zero-length segments) yield finite speeds within [0, vMax]', () => {
    const lim = limits({ dragK: 0.001 });
    const profile = speedProfile(lineFrom([0, 0, 0, 0, 100, 0, 50, 80]), lim);
    expect(profile.length).toBe(4);
    for (const v of Array.from(profile)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(lim.vMax);
    }
  });

  it('POST5: speedProfile is deterministic across calls', () => {
    const line = circle(40, 100);
    const lim = limits({ aeroK: 0.002, dragK: 0.0005, powerPerMass: 300 });
    expect(Array.from(speedProfile(line, lim))).toEqual(Array.from(speedProfile(line, lim)));
  });

  it('POST6: carLimitsFromSpec uses max power over the torque curve, not max torque, and derives vMax from drag only', () => {
    const json: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
    const spec = parseCarSpec(json);
    const torqueCurve: [number, number][] = [[2000, 500], [9000, 250]];
    const custom: CarSpec = {
      ...spec,
      chassis: { ...spec.chassis, massKg: 800 },
      aero: { ...spec.aero, cda: 1.0, claFront: 2.0, claRear: 3.0 },
      engine: { ...spec.engine, torqueCurve },
    };
    const lim = carLimitsFromSpec(custom, 100);
    const pmax = (250 * 9000 * 2 * Math.PI) / 60;
    expect(pmax).toBeGreaterThan((500 * 2000 * 2 * Math.PI) / 60);
    const m = 900;
    expect(lim.powerPerMass).toBeCloseTo((0.9 * pmax) / m, 9);
    expect(lim.aeroK).toBeCloseTo((0.5 * 1.225 * 5.0) / m, 12);
    expect(lim.dragK).toBeCloseTo((0.5 * 1.225 * 1.0) / m, 12);
    expect(lim.vMax).toBeCloseTo(Math.cbrt((0.9 * pmax) / (0.5 * 1.225 * 1.0)), 9);
    expect(lim.vMax).toBe(carLimitsFromSpec(custom, 0).vMax);
  });

  it('POST7: speedProfile source uses no randomness and no 3D engine imports', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'speedProfile.ts'), 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/['"]three['"]/);
    expect(src).not.toMatch(/@dimforge/);
  });
});

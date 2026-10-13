import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengerCurvature, type RacingLine } from '../../../src/ai/racingLine';
import {
  carLimitsFromSpec,
  cornerSpeed,
  speedProfile,
  type CarLimits,
} from '../../../src/ai/speedProfile';
import { parseCarSpec } from '../../../src/physics/carSpec';

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

// Regular n-gon of circumradius r: menger curvature at every vertex is exactly 1/r.
function regularGon(n: number, r: number): RacingLine {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push(r * Math.cos(a), r * Math.sin(a));
  }
  return lineFrom(pts);
}

// r(theta) = 100 - 25 cos(theta): unique tightest vertex at i = 0 (kappa 0.00889 vs >= 0.00894 elsewhere).
function wobblyCircle(n: number): RacingLine {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const r = 100 - 25 * Math.cos(th);
    pts.push(r * Math.cos(th), r * Math.sin(th));
  }
  return lineFrom(pts);
}

function kappaAt(points: Float64Array, i: number): number {
  const n = points.length / 2;
  const ia = ((i - 1 + n) % n) * 2;
  const ib = (i % n) * 2;
  const ic = ((i + 1) % n) * 2;
  return mengerCurvature(
    points[ia], points[ia + 1],
    points[ib], points[ib + 1],
    points[ic], points[ic + 1],
  );
}

describe('088 speed profile edge cases', () => {
  it('EDGE1: cornerSpeed at |kappa| exactly muLat*aeroK returns vMax', () => {
    const lim = limits({ aeroK: 0.003 });
    expect(cornerSpeed(0.0045, lim)).toBe(lim.vMax);
    expect(cornerSpeed(-0.0045, lim)).toBe(lim.vMax);
  });

  it('EDGE2: cornerSpeed caps at vMax when the aero-corrected formula exceeds it', () => {
    const lim = limits({ aeroK: 0.003 });
    const raw = Math.sqrt((1.5 * G) / (0.0046 - 1.5 * 0.003));
    expect(raw).toBeGreaterThan(lim.vMax);
    expect(cornerSpeed(0.0046, lim)).toBe(lim.vMax);
  });

  it('EDGE3: cornerSpeed uses |kappa| so a negative kappa matches the positive one', () => {
    const lim = limits({ aeroK: 0.003 });
    const expected = Math.sqrt((1.5 * G) / (0.01 - 1.5 * 0.003));
    expect(Math.abs(cornerSpeed(-0.01, lim) - expected)).toBeLessThanOrEqual(0.01);
    expect(cornerSpeed(-0.01, lim)).toBe(cornerSpeed(0.01, lim));
  });

  it('EDGE4: speedProfile throws an Error for a line with fewer than 3 points', () => {
    const lim = limits({});
    const empty = { offsets: new Float64Array(0), points: new Float64Array(0), dist: new Float64Array(0), length: 0 };
    expect(() => speedProfile(empty, lim)).toThrow(Error);
    const two = lineFrom([0, 0, 10, 0]);
    expect(() => speedProfile(two, lim)).toThrow(Error);
  });

  it('EDGE5: speedProfile does not mutate the input RacingLine', () => {
    const line = wobblyCircle(40);
    const offsets = Array.from(line.offsets);
    const points = Array.from(line.points);
    const dist = Array.from(line.dist);
    const length = line.length;
    speedProfile(line, limits({ dragK: 0.0005, powerPerMass: 300 }));
    expect(Array.from(line.offsets)).toEqual(offsets);
    expect(Array.from(line.points)).toEqual(points);
    expect(Array.from(line.dist)).toEqual(dist);
    expect(line.length).toBe(length);
  });

  it('EDGE6: profile speeds never exceed vMax even when corner speeds would', () => {
    const line = regularGon(120, 105);
    const lim = limits({ vMax: 30 });
    const corner = Math.sqrt((1.5 * G) / (1 / 105));
    expect(corner).toBeGreaterThan(lim.vMax);
    const profile = speedProfile(line, lim);
    expect(profile.length).toBe(120);
    for (let i = 0; i < profile.length; i++) {
      expect(profile[i]).toBe(lim.vMax);
    }
  });

  it('EDGE7: extreme drag cannot drive the profile negative or NaN', () => {
    const line = regularGon(12, 105);
    const lim = limits({ dragK: 0.05, powerPerMass: 1 });
    const profile = speedProfile(line, lim);
    expect(profile.length).toBe(12);
    for (let i = 0; i < profile.length; i++) {
      expect(Number.isFinite(profile[i])).toBe(true);
      expect(profile[i]).toBeGreaterThanOrEqual(0);
      expect(profile[i]).toBeLessThanOrEqual(lim.vMax);
    }
  });

  it('EDGE8: carLimitsFromSpec follows the spec formulas; fuel scales only mass-dependent fields', () => {
    const json: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
    const spec = parseCarSpec(json);
    const rho = 0.5 * 1.225;
    const pmax = Math.max(
      ...spec.engine.torqueCurve.map(([rpm, torque]) => (torque * rpm * 2 * Math.PI) / 60),
    );
    const fuelKg = 40;
    const m0 = spec.chassis.massKg;
    const m1 = m0 + fuelKg;
    const cda = spec.aero.cda;
    const cla = spec.aero.claFront + spec.aero.claRear;
    const mu0 = spec.tyres.compounds.medium.mu0;

    const dry = carLimitsFromSpec(spec, 0);
    expect(dry.muLat).toBeCloseTo(0.95 * mu0, 12);
    expect(dry.muLong).toBeCloseTo(0.95 * mu0, 12);
    expect(dry.aeroK).toBeCloseTo((rho * cla) / m0, 12);
    expect(dry.dragK).toBeCloseTo((rho * cda) / m0, 12);
    expect(dry.powerPerMass).toBeCloseTo((0.9 * pmax) / m0, 6);
    expect(dry.vMax).toBeCloseTo(Math.cbrt((0.9 * pmax) / (rho * cda)), 6);

    const fueled = carLimitsFromSpec(spec, fuelKg);
    expect(fueled.aeroK).toBeCloseTo((rho * cla) / m1, 12);
    expect(fueled.dragK).toBeCloseTo((rho * cda) / m1, 12);
    expect(fueled.powerPerMass).toBeCloseTo((0.9 * pmax) / m1, 6);
    expect(fueled.muLat).toBe(dry.muLat);
    expect(fueled.muLong).toBe(dry.muLong);
    expect(fueled.vMax).toBe(dry.vMax);
  });

  it('EDGE9: carLimitsFromSpec throws an Error for negative fuel', () => {
    const json: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
    const spec = parseCarSpec(json);
    expect(() => carLimitsFromSpec(spec, -1)).toThrow(Error);
  });

  it('EDGE10: second pass lap overwrites near the seed so the point after it never exceeds the seed', () => {
    const line = wobblyCircle(120);
    const n = line.points.length / 2;
    const lim = limits({ dragK: 0.01, powerPerMass: 100 });
    let seed = 0;
    for (let i = 1; i < n; i++) {
      if (kappaAt(line.points, i) > kappaAt(line.points, seed)) seed = i;
    }
    expect(kappaAt(line.points, seed)).toBeGreaterThan(kappaAt(line.points, (seed + 1) % n));
    const profile = speedProfile(line, lim);
    expect(profile.length).toBe(n);
    const next = profile[(seed + 1) % n];
    expect(next).toBeLessThanOrEqual(profile[seed] + 1e-6);
    expect(next).toBeLessThan(0.9 * Math.sqrt((lim.muLat * G) / kappaAt(line.points, seed)));
  });
});

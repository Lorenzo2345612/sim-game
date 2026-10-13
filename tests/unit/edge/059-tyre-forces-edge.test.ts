import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { magic, tyreMu, tyreForces, relaxAlpha } from '../../../src/physics/tyre';

const ROOT = join(__dirname, '..', '..', '..');

function medium(): TyreCompound {
  const json: unknown = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  );
  return parseCarSpec(json).tyres.compounds.medium;
}

const C = medium();
const D0 = C.mu0 * C.Fz0;

function forces(fz: number, kappa: number, alpha: number, factor: number) {
  return tyreForces(C, fz, kappa, alpha, factor, { fx: 0, fy: 0 });
}

function pureRestated(axis: 'x' | 'y', fz: number, s: number): number {
  const mu = C.mu0 * (1 - (C.loadSens * (fz - C.Fz0)) / C.Fz0);
  const D = mu * fz;
  const B = axis === 'x' ? C.Bx : C.By;
  const Cy = axis === 'x' ? C.Cx : C.Cy;
  const E = axis === 'x' ? C.Ex : C.Ey;
  const Bs = B * s;
  return D * Math.sin(Cy * Math.atan(Bs - E * (Bs - Math.atan(Bs))));
}

describe('059 tyre forces edge cases', () => {
  it('EDGE1: magic matches the Pacejka formula, is odd in s and zero at s = 0', () => {
    const B = 1.1;
    const Cy = 1.4;
    const E = 0.07;
    const D = 250;
    const f = (s: number): number => {
      const Bs = B * s;
      return D * Math.sin(Cy * Math.atan(Bs - E * (Bs - Math.atan(Bs))));
    };
    expect(magic(B, Cy, E, D, 0.35)).toBeCloseTo(f(0.35), 10);
    expect(magic(B, Cy, E, D, 0)).toBeCloseTo(0, 12);
    expect(magic(B, Cy, E, D, -0.35)).toBeCloseTo(-f(0.35), 10);
  });

  it('EDGE2: tyreMu follows the load-sensitivity formula with factor scaling', () => {
    expect(tyreMu(C, C.Fz0, 1)).toBeCloseTo(C.mu0, 12);
    expect(tyreMu(C, 0, 1)).toBeCloseTo(C.mu0 * (1 + C.loadSens), 12);
    expect(tyreMu(C, C.Fz0, 0.5)).toBeCloseTo(0.5 * C.mu0, 12);
    expect(tyreMu(C, 1500, 0.8)).toBeCloseTo(C.mu0 * (1 + 0.025) * 0.8, 12);
  });

  it('EDGE3: tyreForces writes into and returns the same out object, compound untouched', () => {
    const snapshot = JSON.stringify(C);
    const out = { fx: 999, fy: 999 };
    const r = tyreForces(C, C.Fz0, 0.05, 0.05, 1, out);
    expect(r).toBe(out);
    expect(Number.isFinite(out.fx)).toBe(true);
    expect(Number.isFinite(out.fy)).toBe(true);
    expect(out.fx).not.toBe(999);
    expect(out.fy).not.toBe(999);
    expect(JSON.stringify(C)).toBe(snapshot);
  });

  it('EDGE4: fz <= 0 overwrites a dirty out with fx = fy = 0', () => {
    for (const fz of [0, -1234]) {
      const out = { fx: 123, fy: -456 };
      const r = tyreForces(C, fz, 0.2, 0.3, 1, out);
      expect(r).toBe(out);
      expect(out.fx).toBeCloseTo(0, 12);
      expect(out.fy).toBeCloseTo(0, 12);
      expect(Number.isNaN(out.fx)).toBe(false);
      expect(Number.isNaN(out.fy)).toBe(false);
    }
  });

  it('EDGE5: active ellipse scales onto the boundary and preserves the pure direction ratio', () => {
    const kappa = 0.1;
    const alpha = 0.15;
    const fx0 = pureRestated('x', C.Fz0, kappa);
    const fy0 = pureRestated('y', C.Fz0, alpha);
    const sum0 = (fx0 / D0) ** 2 + (fy0 / D0) ** 2;
    expect(sum0).toBeGreaterThan(1);
    const r = forces(C.Fz0, kappa, alpha, 1);
    const sum = (r.fx / D0) ** 2 + (r.fy / D0) ** 2;
    expect(sum).toBeCloseTo(1, 9);
    expect(r.fx / r.fy).toBeCloseTo(fx0 / fy0, 9);
  });

  it('EDGE6: mixed-sign combined slip gives fx < 0, fy > 0 on the ellipse boundary', () => {
    const r = forces(C.Fz0, -0.1, 0.15, 1);
    expect(r.fx).toBeLessThan(0);
    expect(r.fy).toBeGreaterThan(0);
    const val = (r.fx / D0) ** 2 + (r.fy / D0) ** 2;
    expect(val).toBeLessThanOrEqual(1 + 1e-9);
    expect(val).toBeCloseTo(1, 9);
  });

  it('EDGE7: kappa and alpha far beyond the peak are not clamped and match the magic formula', () => {
    const kappa = 3;
    const alpha = 2;
    const r = forces(C.Fz0, kappa, alpha, 1);
    expect(Number.isFinite(r.fx)).toBe(true);
    expect(Number.isFinite(r.fy)).toBe(true);
    expect(r.fx).toBeCloseTo(pureRestated('x', C.Fz0, kappa), 9);
    expect(r.fy).toBeCloseTo(pureRestated('y', C.Fz0, alpha), 9);
    expect(Math.abs(r.fx)).toBeLessThan(D0);
    expect(Math.abs(r.fy)).toBeLessThan(D0);
  });

  it('EDGE8: lateral peak at 2·Fz0 uses the load-sensitive mu', () => {
    const expected = C.mu0 * (1 - C.loadSens) * 2 * C.Fz0;
    let maxFy = -Infinity;
    for (let a = 0; a <= 0.4; a += 0.001) {
      const fy = forces(2 * C.Fz0, 0, a, 1).fy;
      if (fy > maxFy) {
        maxFy = fy;
      }
    }
    expect(Math.abs(maxFy - expected)).toBeLessThanOrEqual(0.01 * expected);
  });

  it('EDGE9: fy is odd in alpha', () => {
    const pos = forces(C.Fz0, 0, 0.12, 1).fy;
    const neg = forces(C.Fz0, 0, -0.12, 1).fy;
    expect(neg).toBeCloseTo(-pos, 10);
  });

  it('EDGE10: relaxAlpha rate uses max(|vx|, V_LOW) so negative and low speeds match', () => {
    const dt = 1 / 120;
    const fast = relaxAlpha(0, 0.1, 60, dt);
    expect(Math.abs(relaxAlpha(0, 0.1, -60, dt) - fast)).toBeLessThanOrEqual(1e-12);
    const standstill = relaxAlpha(0, 0.1, 0, dt);
    expect(Math.abs(relaxAlpha(0, 0.1, 0.4, dt) - standstill)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(relaxAlpha(0, 0.1, -0.4, dt) - standstill)).toBeLessThanOrEqual(1e-12);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { magic, tyreMu, tyreForces, relaxAlpha, RELAX, V_LOW } from '../../../src/physics/tyre';

const ROOT = join(__dirname, '..', '..', '..');

function compoundOf(name: 'soft' | 'medium' | 'hard'): TyreCompound {
  const json: unknown = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  );
  return parseCarSpec(json).tyres.compounds[name];
}

const C = compoundOf('medium');

function synthetic(overrides: Partial<TyreCompound>): TyreCompound {
  return {
    mu0: 2,
    Fz0: 1000,
    loadSens: 0,
    Bx: 10,
    Cx: 1.6,
    Ex: 0,
    By: 8,
    Cy: 1.5,
    Ey: 0,
    optTempC: 80,
    tempWindowC: 40,
    heatCoef: 0,
    coolCoef: 0,
    wearRate: 0,
    wearGripLoss: 0,
    cliffWear: 1,
    ...overrides,
  };
}

function pure(axis: 'x' | 'y', c: TyreCompound, fz: number, s: number, factor: number): number {
  const D = tyreMu(c, fz, factor) * fz;
  const B = axis === 'x' ? c.Bx : c.By;
  const Cy = axis === 'x' ? c.Cx : c.Cy;
  const E = axis === 'x' ? c.Ex : c.Ey;
  return magic(B, Cy, E, D, s);
}

describe('059 tyre forces post edge cases', () => {
  it('EDGE11: zero-grip compound with fz > 0 yields exactly zero forces, no NaN', () => {
    const z = synthetic({ mu0: 0 });
    const out = { fx: 7, fy: 7 };
    const r = tyreForces(z, 5000, 0.3, 0.4, 1, out);
    expect(r).toBe(out);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
    expect(Number.isNaN(out.fx)).toBe(false);
    expect(Number.isNaN(out.fy)).toBe(false);
  });

  it('EDGE12: loadSens 0 keeps peak friction ratio independent of fz', () => {
    const c = synthetic({ mu0: 2, loadSens: 0 });
    const peak = (fz: number): number => {
      let best = -Infinity;
      for (let k = 0; k <= 0.4; k += 0.001) {
        best = Math.max(best, tyreForces(c, fz, k, 0, 1, { fx: 0, fy: 0 }).fx);
      }
      return best / (c.mu0 * fz);
    };
    expect(peak(1000)).toBeCloseTo(1, 3);
    expect(peak(8000)).toBeCloseTo(peak(1000), 6);
  });

  it('EDGE13: fz just above zero stays finite with correct sign', () => {
    const out = tyreForces(C, 1e-9, 0.1, 0.1, 1, { fx: 0, fy: 0 });
    expect(Number.isFinite(out.fx)).toBe(true);
    expect(Number.isFinite(out.fy)).toBe(true);
    expect(out.fx).toBeGreaterThan(0);
    expect(out.fy).toBeGreaterThan(0);
    expect(Math.abs(out.fx)).toBeLessThan(1e-6);
  });

  it('EDGE14: extreme slip keeps both forces finite and bounded by |D|', () => {
    const D = Math.abs(tyreMu(C, C.Fz0, 1) * C.Fz0);
    for (const [k, a] of [
      [1e6, 0],
      [0, 1e6],
      [1e6, -1e6],
      [-1e6, 1e6],
    ] as const) {
      const r = tyreForces(C, C.Fz0, k, a, 1, { fx: 0, fy: 0 });
      expect(Number.isFinite(r.fx)).toBe(true);
      expect(Number.isFinite(r.fy)).toBe(true);
      expect(Math.abs(r.fx)).toBeLessThanOrEqual(D + 1e-9);
      expect(Math.abs(r.fy)).toBeLessThanOrEqual(D + 1e-9);
    }
  });

  it('EDGE15: combined slip below the ellipse threshold leaves both pure values untouched', () => {
    const kappa = 0.02;
    const alpha = 0.03;
    const fx0 = pure('x', C, C.Fz0, kappa, 1);
    const fy0 = pure('y', C, C.Fz0, alpha, 1);
    const D = tyreMu(C, C.Fz0, 1) * C.Fz0;
    expect((fx0 / D) ** 2 + (fy0 / D) ** 2).toBeLessThan(1);
    const r = tyreForces(C, C.Fz0, kappa, alpha, 1, { fx: 0, fy: 0 });
    expect(r.fx).toBeCloseTo(fx0, 12);
    expect(r.fy).toBeCloseTo(fy0, 12);
  });

  it('EDGE16: other compounds scale forces with their own mu0', () => {
    const soft = compoundOf('soft');
    const peak = (c: TyreCompound): number => {
      let best = -Infinity;
      for (let k = 0; k <= 0.4; k += 0.001) {
        best = Math.max(best, tyreForces(c, c.Fz0, k, 0, 1, { fx: 0, fy: 0 }).fx);
      }
      return best;
    };
    const pSoft = peak(soft);
    expect(pSoft).toBeCloseTo(soft.mu0 * soft.Fz0, 0);
    expect(pSoft).toBeGreaterThan(peak(C));
  });

  it('EDGE17: relaxAlpha with dt 0 or alpha already at target is a no-op', () => {
    expect(relaxAlpha(0.07, 0.1, 60, 0)).toBe(0.07);
    expect(relaxAlpha(0.1, 0.1, 60, 1 / 120)).toBe(0.1);
  });

  it('EDGE18: relaxAlpha approaches the target monotonically without overshoot', () => {
    let a = -0.2;
    const target = 0.15;
    for (let i = 0; i < 600; i++) {
      const next = relaxAlpha(a, target, 60, 1 / 120);
      expect(next).toBeGreaterThanOrEqual(a);
      expect(next).toBeLessThanOrEqual(target);
      if (i === 0) expect(next).toBeGreaterThan(a);
      a = next;
    }
    expect(a).toBeCloseTo(target, 9);
  });

  it('EDGE19: relaxAlpha with a huge step reaches the target within float precision', () => {
    expect(relaxAlpha(0, 0.1, 60, 10)).toBeCloseTo(0.1, 12);
  });

  it('EDGE20: exported relaxation constants are RELAX 0.25 m and V_LOW 1.5 m/s', () => {
    expect(RELAX).toBeCloseTo(0.25, 12);
    expect(V_LOW).toBeCloseTo(1.5, 12);
  });

  it('EDGE21: module imports nothing but carSpec and tyreForces allocates nothing', () => {
    const src = readFileSync(join(ROOT, 'src', 'physics', 'tyre.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./carSpec']);
    expect(src).not.toMatch(/three|rapier/i);

    const marker = '): { fx: number; fy: number } {';
    const idx = src.indexOf(marker);
    expect(idx).toBeGreaterThan(0);
    const body = src.slice(idx + marker.length, src.indexOf('export function relaxAlpha'));
    expect(body).not.toMatch(/\bnew\b|=>|\[/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { tyreForces, relaxAlpha } from '../../../src/physics/tyre';

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

describe('059 tyre forces acceptance', () => {
  it('AT1: zero slip at nominal load and factor 1 yields fx = 0, fy = 0', () => {
    const r = forces(C.Fz0, 0, 0, 1);
    expect(r.fx).toBeCloseTo(0, 12);
    expect(r.fy).toBeCloseTo(0, 12);
  });

  it('AT2: kappa sweep 0…0.5 peaks in [0.06, 0.16] with max fx in [0.98·mu0·Fz0, mu0·Fz0 + 1e-6]', () => {
    let maxFx = -Infinity;
    let maxK = 0;
    for (let k = 0; k <= 0.5; k += 0.001) {
      const fx = forces(C.Fz0, k, 0, 1).fx;
      if (fx > maxFx) {
        maxFx = fx;
        maxK = k;
      }
    }
    expect(maxFx).toBeLessThanOrEqual(D0 + 1e-6);
    expect(maxFx).toBeGreaterThanOrEqual(0.98 * D0);
    expect(maxK).toBeGreaterThanOrEqual(0.06);
    expect(maxK).toBeLessThanOrEqual(0.16);
  });

  it('AT3: fx is odd in kappa', () => {
    const pos = forces(C.Fz0, 0.1, 0, 1).fx;
    const neg = forces(C.Fz0, -0.1, 0, 1).fx;
    expect(neg).toBeCloseTo(-pos, 10);
  });

  it('AT4: alpha sweep 0…0.4 rad peaks in [0.10, 0.20] rad with fy in [0.98, 1.0]·mu0·Fz0', () => {
    let maxFy = -Infinity;
    let maxA = 0;
    for (let a = 0; a <= 0.4; a += 0.001) {
      const fy = forces(C.Fz0, 0, a, 1).fy;
      if (fy > maxFy) {
        maxFy = fy;
        maxA = a;
      }
    }
    expect(maxFy).toBeGreaterThanOrEqual(0.98 * D0);
    expect(maxFy).toBeLessThanOrEqual(1.0 * D0);
    expect(maxA).toBeGreaterThanOrEqual(0.1);
    expect(maxA).toBeLessThanOrEqual(0.2);
  });

  it('AT5: at 2·Fz0 the peak fx equals mu0·(1 − loadSens)·2·Fz0 within 1%', () => {
    const expected = C.mu0 * (1 - C.loadSens) * 2 * C.Fz0;
    let maxFx = -Infinity;
    for (let k = 0; k <= 0.5; k += 0.001) {
      const fx = forces(2 * C.Fz0, k, 0, 1).fx;
      if (fx > maxFx) {
        maxFx = fx;
      }
    }
    expect(Math.abs(maxFx - expected)).toBeLessThanOrEqual(0.01 * expected);
  });

  it('AT6: combined slip near both peaks stays inside the friction ellipse and both forces are nonzero', () => {
    const r = forces(C.Fz0, 0.1, 0.15, 1);
    const val = (r.fx / D0) ** 2 + (r.fy / D0) ** 2;
    expect(val).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.fx).not.toBe(0);
    expect(r.fy).not.toBe(0);
  });

  it('AT7: factor 0.5 halves both forces exactly at kappa 0.02, alpha 0', () => {
    const full = forces(C.Fz0, 0.02, 0, 1);
    const half = forces(C.Fz0, 0.02, 0, 0.5);
    expect(half.fx).toBe(full.fx * 0.5);
    expect(half.fy).toBe(full.fy * 0.5);
  });

  it('AT8: relaxAlpha one step matches the exponential formula; vx 0 uses V_LOW 1.5', () => {
    const dt = 1 / 120;
    const e1 = 0.1 * (1 - Math.exp((-dt * 60) / 0.25));
    expect(Math.abs(relaxAlpha(0, 0.1, 60, dt) - e1)).toBeLessThanOrEqual(1e-12);
    const e0 = 0.1 * (1 - Math.exp((-dt * 1.5) / 0.25));
    expect(Math.abs(relaxAlpha(0, 0.1, 0, dt) - e0)).toBeLessThanOrEqual(1e-12);
  });

  it('AT9: zero or negative fz yields fx = fy = 0 with no NaN', () => {
    for (const fz of [0, -C.Fz0]) {
      const r = forces(fz, 0.1, 0.15, 1);
      expect(Number.isFinite(r.fx)).toBe(true);
      expect(Number.isFinite(r.fy)).toBe(true);
      expect(r.fx).toBeCloseTo(0, 12);
      expect(r.fy).toBeCloseTo(0, 12);
    }
  });
});

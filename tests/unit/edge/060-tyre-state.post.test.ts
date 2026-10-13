import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';
import type { TyreCompound } from '../../../src/physics/carSpec';
import {
  AMBIENT_C,
  newTyreState,
  updateTyreState,
  tempFactor,
  pressureFactor,
} from '../../../src/physics/tyreState';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
);
const MEDIUM: TyreCompound = SPEC.tyres.compounds.medium;
const OPT_KPA = SPEC.tyres.optPressureKpa;
const DT = 1 / 120;

describe('060 tyre state post-code gaps', () => {
  it('POST1: dt of 0 or +Infinity leaves tempC and wear unchanged', () => {
    for (const dt of [0, Number.POSITIVE_INFINITY]) {
      const s = newTyreState();
      updateTyreState(s, MEDIUM, 20000, 30, dt, 1, OPT_KPA, OPT_KPA);
      expect(s.tempC, `dt=${dt}`).toBeCloseTo(70, 12);
      expect(s.wear, `dt=${dt}`).toBeCloseTo(0, 12);
    }
  });

  it('POST2: negative or non-finite speed cools like speed 0; speed 40 cools faster than speed 0', () => {
    const coolOnce = (speed: number): number => {
      const s = newTyreState();
      s.tempC = 90;
      updateTyreState(s, MEDIUM, 0, speed, 1, 1, OPT_KPA, OPT_KPA);
      return s.tempC;
    };
    const base = coolOnce(0);
    expect(coolOnce(-30)).toBeCloseTo(base, 12);
    expect(coolOnce(Number.NaN)).toBeCloseTo(base, 12);
    expect(coolOnce(Number.POSITIVE_INFINITY)).toBeCloseTo(base, 12);
    const fast = coolOnce(40);
    expect(fast).toBeLessThan(base);
    expect(Math.abs(fast - (90 - MEDIUM.coolCoef * 65 * 3))).toBeLessThanOrEqual(1e-9);
  });

  it('POST3: pressureFactor is 0.92 at opt ± 20 and floors at 0.9 on the low side too (opt − 30)', () => {
    expect(Math.abs(pressureFactor(OPT_KPA + 20, OPT_KPA) - 0.92)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(pressureFactor(OPT_KPA - 20, OPT_KPA) - 0.92)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(pressureFactor(OPT_KPA - 30, OPT_KPA) - 0.9)).toBeLessThanOrEqual(1e-9);
  });

  it('POST4: tempFactor stays at the 0.75 floor far beyond the window', () => {
    const opt = MEDIUM.optTempC;
    const w = MEDIUM.tempWindowC;
    expect(Math.abs(tempFactor(MEDIUM, opt + 1000 * w) - 0.75)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(tempFactor(MEDIUM, opt - 1000 * w) - 0.75)).toBeLessThanOrEqual(1e-9);
  });

  it('POST5: wear clamps at 1 each step and stays at 1 under continued slip', () => {
    const s = newTyreState();
    let overshoot = false;
    for (let i = 0; i < 500; i++) {
      updateTyreState(s, MEDIUM, 1e9, 0, DT, 1, OPT_KPA, OPT_KPA);
      if (s.wear > 1) overshoot = true;
    }
    expect(overshoot).toBe(false);
    expect(s.wear).toBe(1);
  });

  it('POST6: heat is linear in slipPower (5000 W exact Euler step)', () => {
    const s = newTyreState();
    updateTyreState(s, MEDIUM, 5000, 0, 0.2, 1, OPT_KPA, OPT_KPA);
    const dT = (MEDIUM.heatCoef * 5000 - MEDIUM.coolCoef * (70 - AMBIENT_C)) * 0.2;
    expect(Math.abs(s.tempC - (70 + dT))).toBeLessThanOrEqual(1e-9);
  });

  it('POST7: newTyreState returns independent objects', () => {
    const a = newTyreState();
    const b = newTyreState();
    a.tempC = 100;
    a.wear = 1;
    expect(b.tempC).toBeCloseTo(70, 12);
    expect(b.wear).toBeCloseTo(0, 12);
  });

  it('POST8: tyreState.ts imports neither three nor Rapier', () => {
    const src = readFileSync(join(ROOT, 'src', 'physics', 'tyreState.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['./carSpec']);
    for (const spec of ['three', 'rapier']) {
      expect(src.toLowerCase()).not.toContain(spec);
    }
  });
});

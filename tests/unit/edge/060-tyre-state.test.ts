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
  wearFactor,
  gripFactor,
} from '../../../src/physics/tyreState';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
);
const MEDIUM: TyreCompound = SPEC.tyres.compounds.medium;
const OPT_KPA = SPEC.tyres.optPressureKpa;
const DT = 1 / 120;

describe('060 tyre state edge cases', () => {
  it('EDGE1: AMBIENT_C is 25 and newTyreState starts at tempC 70 with wear 0', () => {
    expect(AMBIENT_C).toBeCloseTo(25, 12);
    const s = newTyreState();
    expect(s.tempC).toBeCloseTo(70, 12);
    expect(s.wear).toBeCloseTo(0, 12);
  });

  it('EDGE2: gripFactor is the product of tempFactor, wearFactor and pressureFactor', () => {
    const perfect = newTyreState();
    perfect.tempC = MEDIUM.optTempC;
    expect(gripFactor(MEDIUM, perfect, OPT_KPA, OPT_KPA)).toBeCloseTo(1, 10);
    const mixed = newTyreState();
    mixed.tempC = MEDIUM.optTempC + MEDIUM.tempWindowC;
    mixed.wear = 0.5;
    expect(gripFactor(MEDIUM, mixed, OPT_KPA + 10, OPT_KPA)).toBeCloseTo(0.643125, 10);
  });

  it('EDGE3: tempFactor is quadratic, 0.9375 at optTempC ± tempWindowC/2', () => {
    const half = MEDIUM.tempWindowC / 2;
    expect(Math.abs(tempFactor(MEDIUM, MEDIUM.optTempC + half) - 0.9375)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(tempFactor(MEDIUM, MEDIUM.optTempC - half) - 0.9375)).toBeLessThanOrEqual(1e-9);
  });

  it('EDGE4: wearFactor ramps the cliff term and applies it only above cliffWear', () => {
    expect(Math.abs(wearFactor(MEDIUM, 0.8) - 0.8)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(wearFactor(MEDIUM, 0.9) - 0.7)).toBeLessThanOrEqual(1e-9);
  });

  it('EDGE5: wearFactor clamps its input to [0, 1]', () => {
    expect(Math.abs(wearFactor(MEDIUM, -0.5) - 1)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(wearFactor(MEDIUM, 1.5) - 0.6)).toBeLessThanOrEqual(1e-9);
  });

  it('EDGE6: pressure scales the heat term only, wear is independent of pressure', () => {
    const atOpt = newTyreState();
    const atHigh = newTyreState();
    updateTyreState(atOpt, MEDIUM, 10000, 0, 0.1, 1, OPT_KPA, OPT_KPA);
    updateTyreState(atHigh, MEDIUM, 10000, 0, 0.1, 1, 1.5 * OPT_KPA, OPT_KPA);
    expect(atOpt.tempC).toBeCloseTo(70.111, 10);
    expect(atHigh.tempC).toBeCloseTo(70.171, 10);
    expect(atOpt.wear).toBeCloseTo(atHigh.wear, 12);
    expect(atOpt.wear).toBeCloseTo(MEDIUM.wearRate * 10000 * 0.1, 12);
  });

  it('EDGE7: non-finite or negative dt and slipPower behave as 0 (temp unchanged for dt, cooling-only for slipPower)', () => {
    for (const badDt of [-1, Number.NaN]) {
      const s = newTyreState();
      s.tempC = 90;
      updateTyreState(s, MEDIUM, 20000, 0, badDt, 1, OPT_KPA, OPT_KPA);
      expect(s.tempC, `dt=${badDt}`).toBeCloseTo(90, 12);
    }
    const zero = newTyreState();
    zero.tempC = 90;
    updateTyreState(zero, MEDIUM, 0, 0, 1, 1, OPT_KPA, OPT_KPA);
    for (const badPower of [-5000, Number.POSITIVE_INFINITY]) {
      const s = newTyreState();
      s.tempC = 90;
      updateTyreState(s, MEDIUM, badPower, 0, 1, 1, OPT_KPA, OPT_KPA);
      expect(s.tempC, `slipPower=${badPower}`).toBeCloseTo(zero.tempC, 12);
      expect(s.tempC).toBeLessThan(90);
    }
  });

  it('EDGE8: wearMult below 0 is treated as 0 and leaves wear unchanged', () => {
    const s = newTyreState();
    s.wear = 0.5;
    updateTyreState(s, MEDIUM, 20000, 30, DT, -3, OPT_KPA, OPT_KPA);
    expect(s.wear).toBeCloseTo(0.5, 12);
  });

  it('EDGE9: updateTyreState mutates only the state, not the compound', () => {
    const snapshot = JSON.parse(JSON.stringify(MEDIUM)) as TyreCompound;
    const s = newTyreState();
    updateTyreState(s, MEDIUM, 20000, 30, DT, 1, OPT_KPA, OPT_KPA);
    expect(JSON.parse(JSON.stringify(MEDIUM))).toEqual(snapshot);
  });

  it('EDGE10: a single large dt step cools past ambient because tempC is not clamped', () => {
    const s = newTyreState();
    s.tempC = 90;
    updateTyreState(s, MEDIUM, 0, 0, 600, 1, OPT_KPA, OPT_KPA);
    expect(s.tempC).toBeCloseTo(12, 6);
    expect(s.tempC).toBeLessThan(AMBIENT_C);
  });
});

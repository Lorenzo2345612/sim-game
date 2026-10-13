import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';
import {
  newTyreState,
  updateTyreState,
  tempFactor,
  wearFactor,
  pressureFactor,
} from '../../../src/physics/tyreState';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
);
const MEDIUM = SPEC.tyres.compounds.medium;
const OPT_KPA = SPEC.tyres.optPressureKpa;

const DT = 1 / 120;

describe('060 tyre temperature, wear and pressure acceptance', () => {
  it('AT1: tempFactor at optTempC is 1', () => {
    expect(tempFactor(MEDIUM, MEDIUM.optTempC)).toBeCloseTo(1, 10);
  });

  it('AT2: tempFactor is 0.75 at optTempC ± tempWindowC and floors at 0.75 at optTempC ± 3·tempWindowC', () => {
    const opt = MEDIUM.optTempC;
    const w = MEDIUM.tempWindowC;
    for (const t of [opt + w, opt - w, opt + 3 * w, opt - 3 * w]) {
      expect(Math.abs(tempFactor(MEDIUM, t) - 0.75), `T=${t}`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT3: wearFactor is 1 / 0.875 / 0.60 at wear 0 / 0.5 / 1.0 with cliffWear 0.8 and wearGripLoss 0.25', () => {
    expect(Math.abs(wearFactor(MEDIUM, 0) - 1)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(wearFactor(MEDIUM, 0.5) - 0.875)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(wearFactor(MEDIUM, 1) - 0.6)).toBeLessThanOrEqual(1e-9);
  });

  it('AT4: slipPower 0 and speed 0 for 600 s bring T from 90 °C to 25 ± 2 °C monotonically with wear unchanged', () => {
    const s = newTyreState();
    s.tempC = 90;
    const steps = 600 / DT;
    let monotonic = true;
    for (let i = 0; i < steps; i++) {
      const prev = s.tempC;
      updateTyreState(s, MEDIUM, 0, 0, DT, 1, OPT_KPA, OPT_KPA);
      if (s.tempC > prev) monotonic = false;
    }
    expect(monotonic).toBe(true);
    expect(Math.abs(s.tempC - 25)).toBeLessThanOrEqual(2);
    expect(s.wear).toBeCloseTo(0, 12);
  });

  it('AT5: constant 20 kW slip power at 30 m/s for 60 s raises T and yields wear = wearRate·20000·60 ± 1 %', () => {
    const s = newTyreState();
    const t0 = s.tempC;
    const steps = 60 / DT;
    for (let i = 0; i < steps; i++) {
      updateTyreState(s, MEDIUM, 20000, 30, DT, 1, OPT_KPA, OPT_KPA);
    }
    expect(s.tempC).toBeGreaterThan(t0);
    const expected = MEDIUM.wearRate * 20000 * 60;
    expect(Math.abs(s.wear - expected)).toBeLessThanOrEqual(0.01 * expected);
  });

  it('AT6: wearMult 3 vs 1 on the same run gives a wear ratio of 3 ± 1 %', () => {
    const run = (wearMult: number): number => {
      const s = newTyreState();
      const steps = 60 / DT;
      for (let i = 0; i < steps; i++) {
        updateTyreState(s, MEDIUM, 20000, 30, DT, wearMult, OPT_KPA, OPT_KPA);
      }
      return s.wear;
    };
    const ratio = run(3) / run(1);
    expect(Math.abs(ratio - 3)).toBeLessThanOrEqual(0.03);
  });

  it('AT7: pressureFactor is 1 at opt, 0.98 at opt ± 10 kPa and 0.9 (floor) at opt + 40 kPa', () => {
    expect(pressureFactor(OPT_KPA, OPT_KPA)).toBeCloseTo(1, 9);
    expect(Math.abs(pressureFactor(OPT_KPA - 10, OPT_KPA) - 0.98)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(pressureFactor(OPT_KPA + 10, OPT_KPA) - 0.98)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(pressureFactor(OPT_KPA + 40, OPT_KPA) - 0.9)).toBeLessThanOrEqual(1e-9);
  });

  it('AT8: wear stays finite and clamped to [0, 1] for any input', () => {
    const cases = [
      { wear: -0.5, slipPower: 0, stepDt: DT, wearMult: 1 },
      { wear: 2, slipPower: 0, stepDt: DT, wearMult: 1 },
      { wear: 0.5, slipPower: 1e12, stepDt: DT, wearMult: 1 },
      { wear: 0.5, slipPower: Number.NaN, stepDt: DT, wearMult: 1 },
      { wear: 0.5, slipPower: -5000, stepDt: DT, wearMult: 1 },
      { wear: 0.5, slipPower: 20000, stepDt: -1, wearMult: 1 },
      { wear: 0.5, slipPower: 20000, stepDt: Number.NaN, wearMult: 1 },
      { wear: 0.5, slipPower: 20000, stepDt: DT, wearMult: -3 },
    ];
    for (const c of cases) {
      const s = newTyreState();
      s.wear = c.wear;
      updateTyreState(s, MEDIUM, c.slipPower, 0, c.stepDt, c.wearMult, OPT_KPA, OPT_KPA);
      const label = `wear=${c.wear} slipPower=${c.slipPower} dt=${c.stepDt} wearMult=${c.wearMult}`;
      expect(Number.isFinite(s.wear), label).toBe(true);
      expect(s.wear, label).toBeGreaterThanOrEqual(0);
      expect(s.wear, label).toBeLessThanOrEqual(1);
    }
  });
});

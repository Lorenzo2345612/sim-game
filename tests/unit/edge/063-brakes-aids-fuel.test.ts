import { describe, it, expect } from 'vitest';
import { brakeTorques, absScale, tcScale } from '../../../src/physics/brakes';
import { fuelFlowKgS, FuelTank } from '../../../src/physics/fuel';

describe('063 brakes, ABS/TC and fuel edge cases', () => {
  it('EDGE1: pedal is clamped to 0..1 (values outside behave as the bound)', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 1.5, 0.6, out);
    expect(out[0]).toBeCloseTo(1260, 6);
    expect(out[2]).toBeCloseTo(840, 6);
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, -0.5, 0.6, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(0, 6);
  });

  it('EDGE2: NaN pedal is treated as 0', () => {
    const out = [9, 9, 9, 9];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, Number.NaN, 0.6, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(0, 6);
    expect(out[3]).toBeCloseTo(0, 6);
  });

  it('EDGE3: bias argument overrides brakes.bias', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 1, 0.4, out);
    expect(out[0]).toBeCloseTo(840, 6);
    expect(out[2]).toBeCloseTo(1260, 6);
  });

  it('EDGE4: ABS thresholds are strict — speed exactly 3 and kappa exactly −slip do not cut', () => {
    const abs = { enabled: true, slip: 0.12 };
    expect(absScale(abs, -0.2, 3)).toBeCloseTo(1, 9);
    expect(absScale(abs, -0.12, 10)).toBeCloseTo(1, 9);
  });

  it('EDGE5: TC threshold is strict — kappa exactly equal to slip does not cut', () => {
    const tc = { enabled: true, slip: 0.2 };
    expect(tcScale(tc, [0.2, 0.1])).toBeCloseTo(1, 9);
  });

  it('EDGE6: fuelFlowKgS with zero or negative power is 0', () => {
    expect(fuelFlowKgS(250, 0, 1)).toBeCloseTo(0, 12);
    expect(fuelFlowKgS(250, -50000, 1)).toBeCloseTo(0, 12);
  });

  it('EDGE7: startL is clamped to 0..capacityL and defaults to spec.startL', () => {
    const over = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 30 });
    expect(over.massKg).toBeCloseTo(20 * 0.745, 9);
    const under = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: -5 });
    expect(under.massKg).toBeCloseTo(0, 12);
    const dflt = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 10 });
    expect(dflt.massKg).toBeCloseTo(10 * 0.745, 9);
  });

  it('EDGE8: litres tracks massKg/densityKgL after burning', () => {
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 });
    tank.burn(100000, 10, 1);
    expect(tank.litres).toBeCloseTo(tank.massKg / 0.745, 9);
    expect(tank.litres).toBeCloseTo(20 - fuelFlowKgS(250, 100000, 1) * 10 / 0.745, 6);
  });

  it('EDGE9: burn inputs and brakeTorques non-out inputs are not mutated', () => {
    const spec = { maxTorque: 4200, bias: 0.6 };
    const out = [0, 0, 0, 0];
    brakeTorques(spec, 0.8, 0.7, out);
    expect(spec.bias).toBe(0.6);
    const kappas = [0.1, 0.3];
    tcScale({ enabled: true, slip: 0.2 }, kappas);
    expect(kappas).toEqual([0.1, 0.3]);
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 });
    tank.burn(100000, 5, 1);
    expect(tank.massKg).toBeLessThanOrEqual(20 * 0.745);
  });

  it('EDGE10: repeated burns accumulate and clamp at 0 without going negative', () => {
    const tank = new FuelTank({ capacityL: 2, densityKgL: 0.745, bsfc: 250, startL: 2 });
    const start = tank.massKg;
    for (let i = 0; i < 50; i++) tank.burn(100000, 10, 1);
    const total = 50 * fuelFlowKgS(250, 100000, 1) * 10;
    expect(start - tank.massKg).toBeCloseTo(Math.min(total, start), 6);
    expect(tank.massKg).toBeGreaterThanOrEqual(0);
    expect(tank.empty()).toBe(tank.massKg === 0);
  });
});

import { describe, it, expect } from 'vitest';
import { brakeTorques, absScale, tcScale } from '../../../src/physics/brakes';
import { fuelFlowKgS, FuelTank } from '../../../src/physics/fuel';

const FUEL = { capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 };

describe('brakeTorques edges', () => {
  it('clamps pedal to 0..1', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4000, bias: 0.6 }, -0.5, 0.6, out);
    expect(out).toEqual([0, 0, 0, 0]);
    brakeTorques({ maxTorque: 4000, bias: 0.6 }, 2, 0.6, out);
    expect(out).toEqual([1200, 1200, 800, 800]);
  });

  it('NaN pedal acts as 0', () => {
    const out = [1, 1, 1, 1];
    brakeTorques({ maxTorque: 4000, bias: 0.6 }, Number.NaN, 0.6, out);
    expect(out).toEqual([0, 0, 0, 0]);
  });

  it('bias argument overrides brakes.bias', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 1000, bias: 0.7 }, 1, 0.5, out);
    expect(out).toEqual([250, 250, 250, 250]);
  });

  it('mutates out and leaves inputs alone', () => {
    const out = [7, 7, 7, 7];
    const brakes = { maxTorque: 4000, bias: 0.6 };
    brakeTorques(brakes, 1, 0.6, out);
    expect(out[0]).toBeCloseTo(1200, 9);
    expect(brakes).toEqual({ maxTorque: 4000, bias: 0.6 });
  });
});

describe('absScale edges', () => {
  const abs = { enabled: true, slip: 0.12 };

  it('speed boundary is strict', () => {
    expect(absScale(abs, -0.2, 3)).toBe(1);
    expect(absScale(abs, -0.2, 3.0001)).toBe(0.5);
  });

  it('kappa threshold is strict', () => {
    expect(absScale(abs, -0.12, 10)).toBe(1);
    expect(absScale(abs, -0.1200001, 10)).toBe(0.5);
  });

  it('non-finite kappa or speed gives 1', () => {
    expect(absScale(abs, Number.NaN, 10)).toBe(1);
    expect(absScale(abs, -0.2, Number.NaN)).toBe(1);
  });
});

describe('tcScale edges', () => {
  const tc = { enabled: true, slip: 0.2 };

  it('threshold is strict and empty list gives 1', () => {
    expect(tcScale(tc, [0.2])).toBe(1);
    expect(tcScale(tc, [0.2000001])).toBe(0.5);
    expect(tcScale(tc, [])).toBe(1);
  });

  it('disabled TC never cuts', () => {
    expect(tcScale({ enabled: false, slip: 0.2 }, [0.9])).toBe(1);
  });
});

describe('fuel edges', () => {
  it('zero or negative power gives zero flow', () => {
    expect(fuelFlowKgS(250, 0, 1)).toBe(0);
    expect(fuelFlowKgS(250, -100000, 3)).toBe(0);
  });

  it('startL clamps to 0..capacityL', () => {
    expect(new FuelTank(FUEL, -5).massKg).toBe(0);
    expect(new FuelTank(FUEL, -5).empty()).toBe(true);
    expect(new FuelTank(FUEL, 999).litres).toBe(20);
    expect(new FuelTank(FUEL).litres).toBe(20);
  });

  it('burn clamps at zero and keeps litres in sync', () => {
    const tank = new FuelTank(FUEL, 1);
    tank.burn(1e12, 1e6, 1);
    expect(tank.massKg).toBe(0);
    expect(tank.litres).toBe(0);
    expect(tank.empty()).toBe(true);
  });

  it('dt 0 or negative burns nothing', () => {
    const tank = new FuelTank(FUEL);
    const initial = tank.massKg;
    tank.burn(100000, 0, 1);
    tank.burn(100000, -10, 1);
    expect(tank.massKg).toBeCloseTo(initial, 12);
  });
});

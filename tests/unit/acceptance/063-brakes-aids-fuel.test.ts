import { describe, it, expect } from 'vitest';
import { brakeTorques, absScale, tcScale } from '../../../src/physics/brakes';
import { fuelFlowKgS, FuelTank } from '../../../src/physics/fuel';

describe('063 brakes, ABS/TC and fuel acceptance', () => {
  it('AT1: maxTorque 4200, pedal 1, bias 0.6 gives [1260, 1260, 840, 840]', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 1, 0.6, out);
    expect(out[0]).toBeCloseTo(1260, 6);
    expect(out[1]).toBeCloseTo(1260, 6);
    expect(out[2]).toBeCloseTo(840, 6);
    expect(out[3]).toBeCloseTo(840, 6);
  });

  it('AT2: pedal 0.5 halves all torques', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 0.5, 0.6, out);
    expect(out[0]).toBeCloseTo(630, 6);
    expect(out[1]).toBeCloseTo(630, 6);
    expect(out[2]).toBeCloseTo(420, 6);
    expect(out[3]).toBeCloseTo(420, 6);
  });

  it('AT3: ABS gives 0.5 only when enabled, speed > 3 and kappa < −slip', () => {
    const abs = { enabled: true, slip: 0.12 };
    expect(absScale(abs, -0.2, 10)).toBeCloseTo(0.5, 9);
    expect(absScale(abs, -0.2, 2)).toBeCloseTo(1, 9);
    expect(absScale(abs, -0.05, 10)).toBeCloseTo(1, 9);
    expect(absScale({ enabled: false, slip: 0.12 }, -0.2, 10)).toBeCloseTo(1, 9);
  });

  it('AT4: TC gives 0.5 when any driven kappa > slip, else 1', () => {
    const tc = { enabled: true, slip: 0.2 };
    expect(tcScale(tc, [0.1, 0.3])).toBeCloseTo(0.5, 9);
    expect(tcScale(tc, [0.1, 0.1])).toBeCloseTo(1, 9);
  });

  it('AT5: fuelFlowKgS(250 g/kWh, 100 kW, mult 1) is 250·100/3.6e6 kg/s', () => {
    expect(fuelFlowKgS(250, 100000, 1)).toBeCloseTo((250 * 100) / 3.6e6, 9);
  });

  it('AT6: 20 L tank at 0.745 kg/L burns 2·flow·60 kg, clamps at 0 and reports empty', () => {
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 });
    const initial = tank.massKg;
    tank.burn(100000, 60, 2);
    expect(initial - tank.massKg).toBeCloseTo(2 * fuelFlowKgS(250, 100000, 1) * 60, 6);
    tank.burn(1e12, 1e6, 1);
    expect(tank.massKg).toBeGreaterThanOrEqual(0);
    expect(tank.empty()).toBe(true);
  });

  it('AT7: negative power (engine braking) burns no fuel', () => {
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 });
    const initial = tank.massKg;
    tank.burn(-50000, 60, 1);
    expect(tank.massKg).toBeCloseTo(initial, 12);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { brakeTorques, absScale, tcScale } from '../../../src/physics/brakes';
import { fuelFlowKgS, FuelTank } from '../../../src/physics/fuel';

const ROOT = join(__dirname, '..', '..', '..');
const FUEL = { capacityL: 20, densityKgL: 0.745, bsfc: 250, startL: 20 };

describe('063 post-implementation gap tests', () => {
  it('POST1: four wheel torques always sum to pedal·maxTorque', () => {
    const out = [0, 0, 0, 0];
    for (const bias of [0, 0.3, 0.5, 0.6, 1]) {
      brakeTorques({ maxTorque: 4200, bias: 0.6 }, 0.8, bias, out);
      expect(out[0] + out[1] + out[2] + out[3]).toBeCloseTo(0.8 * 4200, 6);
    }
  });

  it('POST2: bias 0 puts all torque on the rear axle, bias 1 on the front', () => {
    const out = [1, 1, 1, 1];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 1, 0, out);
    expect(out).toEqual([0, 0, 2100, 2100]);
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, 1, 1, out);
    expect(out).toEqual([2100, 2100, 0, 0]);
  });

  it('POST3: infinite pedal clamps like the finite bounds', () => {
    const out = [0, 0, 0, 0];
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, Infinity, 0.6, out);
    expect(out[0]).toBeCloseTo(1260, 9);
    expect(out[2]).toBeCloseTo(840, 9);
    brakeTorques({ maxTorque: 4200, bias: 0.6 }, -Infinity, 0.6, out);
    expect(out).toEqual([0, 0, 0, 0]);
  });

  it('POST4: zero maxTorque gives zero torque at any pedal', () => {
    const out = [5, 5, 5, 5];
    brakeTorques({ maxTorque: 0, bias: 0.6 }, 1, 0.6, out);
    expect(out).toEqual([0, 0, 0, 0]);
  });

  it('POST5: ABS never cuts at reverse or standstill speed', () => {
    const abs = { enabled: true, slip: 0.12 };
    expect(absScale(abs, -0.5, -10)).toBe(1);
    expect(absScale(abs, -0.5, 0)).toBe(1);
  });

  it('POST6: positive kappa never triggers ABS even at speed', () => {
    expect(absScale({ enabled: true, slip: 0.12 }, 0.4, 30)).toBe(1);
  });

  it('POST7: zero ABS slip cuts on any negative kappa, not on zero kappa', () => {
    const abs = { enabled: true, slip: 0 };
    expect(absScale(abs, -1e-9, 10)).toBe(0.5);
    expect(absScale(abs, 0, 10)).toBe(1);
  });

  it('POST8: infinite speed and kappa magnitudes follow the same ABS rules', () => {
    const abs = { enabled: true, slip: 0.12 };
    expect(absScale(abs, -Infinity, 50)).toBe(0.5);
    expect(absScale(abs, -0.2, Infinity)).toBe(0.5);
    expect(absScale(abs, Infinity, 50)).toBe(1);
  });

  it('POST9: NaN driven kappas are ignored, a valid slip still cuts TC', () => {
    const tc = { enabled: true, slip: 0.2 };
    expect(tcScale(tc, [Number.NaN, 0.3])).toBe(0.5);
    expect(tcScale(tc, [Number.NaN])).toBe(1);
  });

  it('POST10: zero TC slip cuts on any positive kappa, not on zero kappa', () => {
    const tc = { enabled: true, slip: 0 };
    expect(tcScale(tc, [0.001])).toBe(0.5);
    expect(tcScale(tc, [0])).toBe(1);
  });

  it('POST11: fuel flow scales linearly with the multiplier and is zero at mult 0', () => {
    const base = fuelFlowKgS(250, 100000, 1);
    expect(fuelFlowKgS(250, 100000, 2)).toBeCloseTo(2 * base, 12);
    expect(fuelFlowKgS(250, 100000, 0)).toBe(0);
  });

  it('POST12: zero bsfc gives zero flow at any power', () => {
    expect(fuelFlowKgS(0, 500000, 3)).toBe(0);
  });

  it('POST13: burn with zero or negative multiplier is a no-op', () => {
    const tank = new FuelTank(FUEL);
    const mass = tank.massKg;
    const litres = tank.litres;
    tank.burn(100000, 30, 0);
    expect(tank.massKg).toBe(mass);
    expect(tank.litres).toBe(litres);
    tank.burn(100000, 30, -2);
    expect(tank.massKg).toBe(mass);
    expect(tank.litres).toBe(litres);
  });

  it('POST14: empty() is false while fuel remains and after a partial burn', () => {
    const tank = new FuelTank(FUEL);
    expect(tank.empty()).toBe(false);
    tank.burn(100000, 10, 1);
    expect(tank.empty()).toBe(false);
  });

  it('POST15: zero-capacity tank starts empty and stays exactly empty', () => {
    const tank = new FuelTank({ capacityL: 0, densityKgL: 0.745, bsfc: 250, startL: 0 });
    expect(tank.massKg).toBe(0);
    expect(tank.litres).toBe(0);
    expect(tank.empty()).toBe(true);
    tank.burn(100000, 60, 1);
    expect(tank.massKg).toBe(0);
    expect(tank.litres).toBe(0);
  });

  it('POST16: zero-density tank never produces non-finite litres', () => {
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0, bsfc: 250, startL: 20 });
    expect(tank.empty()).toBe(true);
    tank.burn(100000, 60, 1);
    expect(Number.isFinite(tank.litres)).toBe(true);
    expect(tank.litres).toBe(0);
    expect(tank.massKg).toBe(0);
  });

  it('POST17: negative power burns nothing even over a huge time step', () => {
    const tank = new FuelTank(FUEL);
    const mass = tank.massKg;
    tank.burn(-1e6, 1e9, 5);
    expect(tank.massKg).toBe(mass);
    expect(tank.litres).toBe(FUEL.startL);
  });

  it('POST18: sources import neither three nor Rapier', () => {
    for (const file of ['brakes.ts', 'fuel.ts']) {
      const src = readFileSync(join(ROOT, 'src', 'physics', file), 'utf8');
      expect(src).not.toMatch(/['"]three/);
      expect(src).not.toMatch(/rapier/i);
    }
  });

  it('POST19: torque sum is conserved even for bias outside 0..1', () => {
    const out = [0, 0, 0, 0];
    for (const bias of [-0.5, 1.5]) {
      brakeTorques({ maxTorque: 4200, bias: 0.6 }, 0.7, bias, out);
      expect(out[0] + out[1] + out[2] + out[3]).toBeCloseTo(0.7 * 4200, 6);
    }
  });

  it('POST20: negative bsfc gives non-positive flow and burn is a no-op', () => {
    expect(fuelFlowKgS(-100, 100000, 1)).toBeLessThanOrEqual(0);
    const tank = new FuelTank({ capacityL: 20, densityKgL: 0.745, bsfc: -100, startL: 20 });
    const mass = tank.massKg;
    tank.burn(100000, 60, 1);
    expect(tank.massKg).toBe(mass);
    expect(tank.litres).toBe(20);
  });

  it('POST21: negative multiplier scales flow negative (burn still guards it)', () => {
    const base = fuelFlowKgS(250, 100000, 1);
    expect(fuelFlowKgS(250, 100000, -1)).toBeCloseTo(-base, 12);
  });

  it('POST22: negative density reports empty with finite zero litres', () => {
    const tank = new FuelTank({ capacityL: 20, densityKgL: -0.745, bsfc: 250, startL: 20 });
    expect(tank.empty()).toBe(true);
    tank.burn(100000, 60, 1);
    expect(Number.isFinite(tank.litres)).toBe(true);
    expect(tank.litres).toBe(0);
  });

  it('POST23: infinite driven kappa cuts TC, disabled TC never does', () => {
    expect(tcScale({ enabled: true, slip: 0.2 }, [Infinity])).toBe(0.5);
    expect(tcScale({ enabled: false, slip: 0.2 }, [Infinity])).toBe(1);
  });
});

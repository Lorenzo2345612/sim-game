import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { tyreMu, tyreForces, V_LOW } from '../../../src/physics/tyre';
import {
  solveWheel,
  type WheelSolveInput,
  type WheelSolveOutput,
} from '../../../src/physics/wheelSolver';

const ROOT = join(__dirname, '..', '..', '..');

function medium(): TyreCompound {
  const json: unknown = JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  );
  return parseCarSpec(json).tyres.compounds.medium;
}

const C = medium();
const R = 0.28;
const INERTIA = 1.2;
const MASS_SHARE = 650 / 4;
const DT = 1 / 120;
const OMEGA0 = 30 / R;

function baseInput(over: Partial<WheelSolveInput> = {}): WheelSolveInput {
  return {
    omega: OMEGA0,
    r: R,
    inertia: INERTIA,
    driveTorque: 0,
    brakeTorque: 0,
    vx: 30,
    fz: C.Fz0,
    compound: C,
    factor: 1,
    alpha: 0,
    massShare: MASS_SHARE,
    dt: DT,
    ...over,
  };
}

function solve(over: Partial<WheelSolveInput> = {}): WheelSolveOutput {
  const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
  solveWheel(baseInput(over), out);
  return out;
}

describe('064 wheel solver edge cases', () => {
  it('EDGE1: fz <= 0 zeroes the tyre force and lets omega advance under the torques only', () => {
    const a = solve({ fz: 0, omega: 100, driveTorque: 2000 });
    expect(a.fx).toBeCloseTo(0, 12);
    expect(a.fy).toBeCloseTo(0, 12);
    expect(a.omega1).toBeCloseTo(100 + (DT / INERTIA) * 2000, 9);

    const b = solve({ fz: 0, omega: 100, brakeTorque: 500 });
    expect(b.fx).toBeCloseTo(0, 12);
    expect(b.fy).toBeCloseTo(0, 12);
    expect(b.omega1).toBeCloseTo(100 - (DT / INERTIA) * 500, 9);

    const c = solve({ fz: -500, omega: -100, brakeTorque: 500, alpha: 0.3 });
    expect(c.fx).toBeCloseTo(0, 12);
    expect(c.fy).toBeCloseTo(0, 12);
    expect(c.omega1).toBeCloseTo(-100 + (DT / INERTIA) * 500, 9);

    const d = solve({ fz: 0, omega: 0, driveTorque: 2000 });
    expect(d.fx).toBeCloseTo(0, 12);
    expect(d.omega1).toBeCloseTo((DT / INERTIA) * 2000, 9);
  });

  it('EDGE2: safety clamp caps the opposing longitudinal force at massShare·|vx|/dt and binds below mu·fz', () => {
    const mu = tyreMu(C, 3000, 1);
    for (const dt of [DT, 1 / 30]) {
      const r = solve({ omega: -5 / R, vx: 0.1, fz: 3000, dt });
      const cap = (MASS_SHARE * Math.abs(0.1)) / dt;
      expect(r.fx).toBeLessThan(0);
      expect(Math.abs(r.fx)).toBeCloseTo(cap, 6);
      expect(Math.abs(r.fx)).toBeLessThan(mu * 3000);
    }
  });

  it('EDGE3: a stopped wheel under brake at speed stays locked when the tyre reaction is below the brake torque', () => {
    const r = solve({ omega: 0, vx: 30, brakeTorque: 5000 });
    expect(r.locked).toBe(true);
    expect(r.omega1).toBe(0);
    expect(r.fx).toBeLessThan(0);
    expect(Math.abs(r.fx)).toBeLessThanOrEqual(tyreMu(C, C.Fz0, 1) * C.Fz0 * 1.0001);
  });

  it('EDGE4: a stopped wheel restarts when the drive torque exceeds the brake torque', () => {
    const r = solve({ omega: 0, vx: 30, driveTorque: 2000, brakeTorque: 100 });
    expect(r.omega1).toBeGreaterThan(0);
    expect(Number.isFinite(r.omega1)).toBe(true);
    expect(r.fx).toBeLessThan(0);
  });

  it('EDGE5: outputs satisfy the wheel update, the implicit fixed point and fy at the final kappa', () => {
    const p = baseInput({
      omega: 80,
      vx: 30,
      driveTorque: 800,
      brakeTorque: 300,
      fz: 2000,
      alpha: 0.1,
      factor: 0.9,
    });
    const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
    solveWheel(p, out);

    expect(out.locked).toBe(false);
    expect(out.omega1).toBeCloseTo(
      80 + (DT / INERTIA) * (p.driveTorque - p.brakeTorque - R * out.fx),
      9,
    );

    const s1 = out.omega1 * R - p.vx - (out.fx / MASS_SHARE) * DT;
    const ve = Math.max(Math.abs(p.vx), V_LOW);
    const fixed = tyreForces(C, p.fz, s1 / ve, p.alpha, p.factor, { fx: 0, fy: 0 });
    expect(Math.abs(out.fx - fixed.fx)).toBeLessThan(0.1);

    const kappaFinal = (out.omega1 * R - p.vx) / ve;
    const fyExpected = tyreForces(C, p.fz, kappaFinal, p.alpha, p.factor, {
      fx: 0,
      fy: 0,
    }).fy;
    expect(out.fy).toBeCloseTo(fyExpected, 6);
  });

  it('EDGE6: free rolling in reverse keeps omega and yields |fx| < 1 N', () => {
    const omega = -30 / R;
    const r = solve({ omega, vx: -30, driveTorque: 0, brakeTorque: 0 });
    expect(Math.abs(r.fx)).toBeLessThan(1);
    expect(Math.abs(r.omega1 - omega)).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE7: braking to a stop while reversing clamps omega to 0 with a positive drag force', () => {
    const r = solve({ omega: -1, vx: -30, brakeTorque: 5000 });
    expect(r.locked).toBe(true);
    expect(r.omega1).toBe(0);
    expect(r.fx).toBeGreaterThan(0);
    expect(r.fx).toBeLessThanOrEqual(tyreMu(C, C.Fz0, 1) * C.Fz0 * 1.0001);
  });

  it('EDGE8: a brake torque below the tyre reaction does not lock the wheel', () => {
    const r = solve({ omega: OMEGA0, vx: 30, brakeTorque: 500 });
    expect(r.locked).toBe(false);
    expect(r.omega1).toBeGreaterThan(0);
    expect(r.fx).toBeLessThan(0);
  });

  it('EDGE9: solveWheel overwrites every out field, leaves p untouched and is repeatable', () => {
    const p = baseInput({ omega: 80, vx: 30, driveTorque: 500, alpha: 0.15 });
    const snapshot = JSON.stringify(p);
    const out: WheelSolveOutput = { omega1: -999, fx: 123456, fy: -654321, locked: true };
    solveWheel(p, out);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(out.omega1).not.toBe(-999);
    expect(out.fx).not.toBe(123456);
    expect(out.fy).not.toBe(-654321);
    expect(Math.abs(out.fy)).toBeGreaterThan(1);
    expect(out.locked).toBe(false);

    const again: WheelSolveOutput = { omega1: 7, fx: -8, fy: 9, locked: true };
    solveWheel(p, again);
    expect(again).toEqual(out);
  });

  it('EDGE10: fy at the final kappa is reduced onto the friction ellipse for a locked wheel', () => {
    const r = solve({ omega: OMEGA0, vx: 30, brakeTorque: 5000, alpha: 0.3 });
    const D = tyreMu(C, C.Fz0, 1) * C.Fz0;
    const pure = tyreForces(C, C.Fz0, 0, 0.3, 1, { fx: 0, fy: 0 }).fy;
    expect(r.fy).toBeGreaterThan(0);
    expect(Math.abs(r.fy)).toBeLessThan(pure);
    expect((r.fx / D) ** 2 + (r.fy / D) ** 2).toBeLessThanOrEqual(1 + 1e-3);
  });
});

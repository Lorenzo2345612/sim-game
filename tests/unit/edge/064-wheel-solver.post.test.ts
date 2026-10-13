import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { tyreForces, tyreMu, V_LOW } from '../../../src/physics/tyre';
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

function baseInput(over: Partial<WheelSolveInput> = {}): WheelSolveInput {
  return {
    omega: 30 / R,
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

describe('064 wheel solver post-code gaps', () => {
  it('module keeps three/rapier out and the solve path allocates nothing', () => {
    const src = readFileSync(join(ROOT, 'src', 'physics', 'wheelSolver.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/rapier/i);
    const code = src.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bnew\b/);
    expect(code).not.toMatch(/\[/);
    expect(code).not.toMatch(/=>/);
    expect(code).not.toMatch(/\bObject\.|\bArray\./);
  });

  it('zero grip factor yields zero force and pure torque advance', () => {
    const r = solve({
      omega: 40,
      vx: 12,
      driveTorque: 800,
      brakeTorque: 200,
      factor: 0,
      alpha: 0.2,
    });
    expect(r.fx).toBe(0);
    expect(r.fy).toBe(0);
    expect(r.locked).toBe(false);
    expect(r.omega1).toBeCloseTo(40 + (DT / INERTIA) * (800 - 200), 9);
  });

  it('slip denominator floors at V_LOW below 1.5 m/s', () => {
    const vx = 1.0;
    const r = solve({ omega: vx / R, vx, driveTorque: 200, fz: 2000 });
    const s1 = r.omega1 * R - vx - (r.fx / MASS_SHARE) * DT;
    const viaFloor = tyreForces(C, 2000, s1 / V_LOW, 0, 1, { fx: 0, fy: 0 });
    const viaVx = tyreForces(C, 2000, s1 / Math.abs(vx), 0, 1, { fx: 0, fy: 0 });
    expect(Math.abs(r.fx - viaFloor.fx)).toBeLessThan(0.1);
    expect(Math.abs(r.fx - viaVx.fx)).toBeGreaterThan(1);
  });

  it('omega below 1e-4 counts as zero spin for the brake torque sign', () => {
    const below = solve({ omega: 5e-5, fz: 0, driveTorque: 0, brakeTorque: 100 });
    expect(below.omega1).toBeCloseTo(5e-5, 12);
    const above = solve({ omega: 2e-3, fz: 0, driveTorque: 0, brakeTorque: 100 });
    expect(above.omega1).toBe(0);

    const base = { vx: 25, driveTorque: 600, brakeTorque: 200, fz: C.Fz0 };
    const zero = solve({ ...base, omega: 0 });
    const tiny = solve({ ...base, omega: 5e-5 });
    expect(tiny.omega1).toBeCloseTo(zero.omega1, 12);
    expect(tiny.fx).toBeCloseTo(zero.fx, 12);
    expect(tiny.fy).toBeCloseTo(zero.fy, 12);
    expect(tiny.locked).toBe(zero.locked);
  });

  it('zero dt leaves omega untouched and returns finite bounded forces', () => {
    const r = solve({
      omega: 40,
      vx: 15,
      driveTorque: 900,
      brakeTorque: 0,
      alpha: 0.2,
      dt: 0,
    });
    expect(r.omega1).toBe(40);
    expect(r.locked).toBe(false);
    expect(Number.isFinite(r.fx)).toBe(true);
    expect(Number.isFinite(r.fy)).toBe(true);
    expect(Math.abs(r.fx)).toBeLessThanOrEqual(tyreMu(C, C.Fz0, 1) * C.Fz0 * (1 + 1e-6));
  });

  it('a large step stays finite, locks under huge brake and keeps the friction bound', () => {
    const dt = 0.5;
    const locked = solve({ brakeTorque: 50000, dt });
    expect(locked.locked).toBe(true);
    expect(locked.omega1).toBe(0);
    expect(locked.fx).toBeLessThan(0);
    expect(Math.abs(locked.fx)).toBeLessThanOrEqual(
      tyreMu(C, C.Fz0, 1) * C.Fz0 * (1 + 1e-6),
    );

    const launch = solve({ omega: 0, vx: 0, driveTorque: 2500, brakeTorque: 0, dt });
    expect(Number.isFinite(launch.omega1)).toBe(true);
    expect(Number.isFinite(launch.fx)).toBe(true);
    expect(Math.abs(launch.fx)).toBeLessThanOrEqual(
      tyreMu(C, C.Fz0, 1) * C.Fz0 * (1 + 1e-6),
    );
  });

  it('a locked wheel satisfies the chassis-only implicit fixed point', () => {
    const r = solve({ brakeTorque: 50000, alpha: 0.15 });
    expect(r.locked).toBe(true);
    expect(r.omega1).toBe(0);
    const ve = Math.max(30, V_LOW);
    const s1 = -30 - (r.fx / MASS_SHARE) * DT;
    const ref = tyreForces(C, C.Fz0, s1 / ve, 0.15, 1, { fx: 0, fy: 0 });
    expect(Math.abs(r.fx - ref.fx)).toBeLessThan(0.1);
    const fyRef = tyreForces(C, C.Fz0, (0 * R - 30) / ve, 0.15, 1, {
      fx: 0,
      fy: 0,
    }).fy;
    expect(r.fy).toBeCloseTo(fyRef, 6);
  });

  it('the safety clamp scales linearly with massShare', () => {
    for (const m of [50, 150]) {
      const r = solve({ omega: -8 / R, vx: 0.1, fz: 3000, massShare: m });
      expect(r.fx).toBeLessThan(0);
      expect(Math.abs(r.fx)).toBeCloseTo((m * 0.1) / DT, 6);
    }
    const loose = solve({ omega: -8 / R, vx: 0.1, fz: 3000, massShare: 1000 });
    expect(Math.abs(loose.fx)).toBeLessThan((1000 * 0.1) / DT);
  });

  it('airborne brake clamps a zero crossing but drive may flip the spin freely', () => {
    const fwd = solve({ fz: 0, omega: 0.01, driveTorque: 0, brakeTorque: 500 });
    expect(fwd.omega1).toBe(0);
    const rev = solve({ fz: 0, omega: -0.01, driveTorque: 0, brakeTorque: 500 });
    expect(rev.omega1).toBe(0);
    const driven = solve({ fz: 0, omega: 0.01, driveTorque: -500, brakeTorque: 0 });
    expect(driven.locked).toBe(false);
    expect(driven.omega1).toBeLessThan(0);
  });
});

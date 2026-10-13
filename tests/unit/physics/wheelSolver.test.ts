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

describe('wheelSolver edges', () => {
  it('free rolling forward and reverse keeps omega exactly and yields zero force', () => {
    for (const v of [30, -30]) {
      const r = solve({ omega: v / R, vx: v });
      expect(Math.abs(r.fx)).toBeLessThan(1);
      expect(r.omega1).toBeCloseTo(v / R, 9);
      expect(r.locked).toBe(false);
    }
  });

  it('fz <= 0 gives zero force, no lock and free torque advance', () => {
    const r = solve({ fz: 0, omega: 50, driveTorque: 1000, brakeTorque: 200 });
    expect(r.fx).toBe(0);
    expect(r.fy).toBe(0);
    expect(r.locked).toBe(false);
    expect(r.omega1).toBeCloseTo(50 + (DT / INERTIA) * (1000 - 200), 9);
  });

  it('brake below the tyre reaction slows omega without locking', () => {
    const r = solve({ omega: 20, vx: 20, brakeTorque: 400 });
    expect(r.locked).toBe(false);
    expect(r.omega1).toBeGreaterThan(0);
    expect(r.fx).toBeLessThan(0);
  });

  it('a stopped wheel stays locked while drive minus tyre reaction is under the brake', () => {
    const r = solve({ omega: 0, vx: 25, brakeTorque: 4000 });
    expect(r.locked).toBe(true);
    expect(r.omega1).toBe(0);
    expect(r.fx).toBeLessThan(0);
  });

  it('a stopped wheel restarts forward or reverse according to the drive sign', () => {
    const fwd = solve({ omega: 0, vx: 25, driveTorque: 1500, brakeTorque: 200 });
    expect(fwd.locked).toBe(false);
    expect(fwd.omega1).toBeGreaterThan(0);

    const rev = solve({ omega: 0, vx: 25, driveTorque: -1500, brakeTorque: 200 });
    expect(rev.locked).toBe(false);
    expect(rev.omega1).toBeLessThan(0);
  });

  it('braking across zero clamps omega to 0 from both spin directions', () => {
    const fwd = solve({ omega: 5, brakeTorque: 4000 });
    expect(fwd.locked).toBe(true);
    expect(fwd.omega1).toBe(0);
    const rev = solve({ omega: -5, brakeTorque: 4000 });
    expect(rev.locked).toBe(true);
    expect(rev.omega1).toBe(0);
  });

  it('outputs satisfy the wheel update and the implicit fixed point', () => {
    const p = baseInput({ omega: 60, vx: 18, driveTorque: 600, brakeTorque: 150, fz: 1800 });
    const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
    solveWheel(p, out);
    expect(out.locked).toBe(false);
    expect(out.omega1).toBeCloseTo(
      60 + (DT / INERTIA) * (600 - 150 - R * out.fx),
      9,
    );
    const s1 = out.omega1 * R - 18 - (out.fx / MASS_SHARE) * DT;
    const ve = Math.max(18, V_LOW);
    const fixed = tyreForces(C, 1800, s1 / ve, 0, 1, { fx: 0, fy: 0 });
    expect(Math.abs(out.fx - fixed.fx)).toBeLessThan(0.1);
  });

  it('safety clamp caps the opposing force at massShare·|vx|/dt but leaves assistance alone', () => {
    const capped = solve({ omega: -8 / R, vx: 0.1, fz: 3000 });
    expect(capped.fx).toBeLessThan(0);
    expect(Math.abs(capped.fx)).toBeCloseTo((MASS_SHARE * 0.1) / DT, 6);
    expect(Math.abs(capped.fx)).toBeLessThan(tyreMu(C, 3000, 1) * 3000);

    const driven = solve({ omega: 20, vx: 5, driveTorque: 1200, fz: 3000 });
    expect(driven.fx).toBeGreaterThan(0);
    expect(driven.fx).toBeLessThanOrEqual(tyreMu(C, 3000, 1) * 3000 * (1 + 1e-6));
  });

  it('fy is taken at the final kappa and sits on the friction ellipse when combined', () => {
    const r = solve({ omega: 30 / R, vx: 30, brakeTorque: 4000, alpha: 0.25 });
    const D = tyreMu(C, C.Fz0, 1) * C.Fz0;
    const pure = tyreForces(C, C.Fz0, 0, 0.25, 1, { fx: 0, fy: 0 }).fy;
    expect(Math.abs(r.fy)).toBeGreaterThan(0);
    expect(Math.abs(r.fy)).toBeLessThan(Math.abs(pure));
    const ve = Math.max(30, V_LOW);
    const fyAt = tyreForces(C, C.Fz0, (r.omega1 * R - 30) / ve, 0.25, 1, { fx: 0, fy: 0 });
    expect(r.fy).toBeCloseTo(fyAt.fy, 6);
    // fx is evaluated at s1 (incl. chassis velocity update), so the pair is on the ellipse only up to that κ difference
    expect((r.fx / D) ** 2 + (r.fy / D) ** 2).toBeLessThanOrEqual(1 + 5e-3);
  });

  it('does not mutate the input, overwrites out and is deterministic', () => {
    const p = baseInput({ omega: 70, vx: 22, driveTorque: 400, alpha: 0.1 });
    const snapshot = JSON.stringify(p);
    const a: WheelSolveOutput = { omega1: 1, fx: 2, fy: 3, locked: true };
    const b: WheelSolveOutput = { omega1: -1, fx: -2, fy: -3, locked: false };
    solveWheel(p, a);
    solveWheel(p, b);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a.locked).toBe(false);
  });

  it('randomised multi-step launch stays finite and within mu·fz', () => {
    let seed = 123456789;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let omega = 0;
    let vx = 0;
    for (let i = 0; i < 2000; i++) {
      const fz = 500 + rand() * 3000;
      const factor = 0.5 + rand() * 0.5;
      const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
      solveWheel(
        baseInput({
          omega,
          vx,
          driveTorque: rand() * 2500 - 500,
          brakeTorque: rand() * 3000,
          fz,
          alpha: rand() * 0.6 - 0.3,
          factor,
        }),
        out,
      );
      expect(Number.isFinite(out.omega1)).toBe(true);
      expect(Number.isFinite(out.fx)).toBe(true);
      expect(Number.isFinite(out.fy)).toBe(true);
      expect(Math.abs(out.fx)).toBeLessThanOrEqual(tyreMu(C, fz, factor) * fz * (1 + 1e-6));
      omega = out.omega1;
      vx += (out.fx / MASS_SHARE) * DT;
    }
  });
});

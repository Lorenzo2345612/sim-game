import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { tyreMu, V_LOW } from '../../../src/physics/tyre';
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('064 wheel solver acceptance', () => {
  it('AT1: free rolling with no torques keeps omega and yields |fx| < 1 N', () => {
    const r = solve({ omega: OMEGA0, vx: 30, driveTorque: 0, brakeTorque: 0 });
    expect(Math.abs(r.fx)).toBeLessThan(1);
    expect(Math.abs(r.omega1 - OMEGA0)).toBeLessThanOrEqual(1e-6);
  });

  it('AT2: huge brake at vx 30 locks the wheel with omega1 = 0 and |fx| within mu·fz', () => {
    const r = solve({ brakeTorque: 5000 });
    const mu = tyreMu(C, C.Fz0, 1);
    expect(r.locked).toBe(true);
    expect(r.omega1).toBe(0);
    expect(r.fx).toBeLessThan(0);
    expect(Math.abs(r.fx)).toBeLessThanOrEqual(mu * C.Fz0 * 1.0001);
  });

  it('AT3: from standstill with brake on, omega1 = 0 and safety clamp forces fx = 0', () => {
    const r = solve({ omega: 0, vx: 0, brakeTorque: 1000 });
    expect(r.omega1).toBe(0);
    expect(r.fx).toBeCloseTo(0, 12);
  });

  it('AT4: drive 2000 N·m launch over 120 steps keeps omega monotonic non-decreasing and kappa settles in [0.06, 0.25]', () => {
    let omega = 0;
    let vx = 0;
    let prev = 0;
    let monotonic = true;
    for (let i = 0; i < 120; i++) {
      const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
      solveWheel(baseInput({ omega, vx, driveTorque: 2000 }), out);
      if (out.omega1 < prev - 1e-9) monotonic = false;
      prev = out.omega1;
      omega = out.omega1;
      vx += (out.fx / MASS_SHARE) * DT;
    }
    expect(monotonic).toBe(true);
    const kappa = (omega * R - vx) / Math.max(Math.abs(vx), V_LOW);
    expect(kappa).toBeGreaterThanOrEqual(0.06);
    expect(kappa).toBeLessThanOrEqual(0.25);
  });

  it('AT5: 10 000-case seeded sweep yields finite outputs with |fx| ≤ mu·fz·(1 + 1e-6)', () => {
    const rand = mulberry32(64);
    const range = (a: number, b: number) => a + rand() * (b - a);
    let allFinite = true;
    let overBound = 0;
    for (let i = 0; i < 10000; i++) {
      const input = baseInput({
        omega: range(-400, 400),
        r: range(0.2, 0.4),
        inertia: range(0.5, 3),
        driveTorque: range(-3000, 3000),
        brakeTorque: range(0, 6000),
        vx: range(-80, 80),
        fz: range(0, 4000),
        factor: range(0.4, 1.1),
        alpha: range(-0.7, 0.7),
      });
      const out: WheelSolveOutput = { omega1: 0, fx: 0, fy: 0, locked: false };
      solveWheel(input, out);
      if (
        !Number.isFinite(out.omega1) ||
        !Number.isFinite(out.fx) ||
        !Number.isFinite(out.fy)
      ) {
        allFinite = false;
      }
      const mu = tyreMu(C, input.fz, input.factor);
      if (Math.abs(out.fx) > mu * input.fz * (1 + 1e-6)) overBound++;
    }
    expect(allFinite).toBe(true);
    expect(overBound).toBe(0);
  });

  it('AT6: omega crossing zero under braking clamps to exactly 0 in both directions', () => {
    const fwd = solve({ omega: 1, brakeTorque: 5000 });
    expect(fwd.omega1).toBe(0);
    const rev = solve({ omega: -1, brakeTorque: 5000 });
    expect(rev.omega1).toBe(0);
  });
});

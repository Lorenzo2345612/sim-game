import type { TyreCompound } from './carSpec';
import { tyreForces, V_LOW } from './tyre';

const OMEGA_EPS = 1e-4;
const NEWTON_STEPS = 4;
const BISECT_STEPS = 16;
const KAPPA_STEP = 1e-6;

export interface WheelSolveInput {
  omega: number;
  r: number;
  inertia: number;
  driveTorque: number;
  brakeTorque: number;
  vx: number;
  fz: number;
  compound: TyreCompound;
  factor: number;
  alpha: number;
  massShare: number;
  dt: number;
}

export interface WheelSolveOutput {
  omega1: number;
  fx: number;
  fy: number;
  locked: boolean;
}

function fxAt(
  c: TyreCompound,
  fz: number,
  factor: number,
  alpha: number,
  kappa: number,
  scratch: WheelSolveOutput,
): number {
  tyreForces(c, fz, kappa, alpha, factor, scratch);
  return scratch.fx;
}

// Implicit slip step s1 = sFree − dt·c·Fx(s1) by bracketed Newton on [0, sFree] with bisection fallback.
function solveSlip(
  p: WheelSolveInput,
  scratch: WheelSolveOutput,
  sFree: number,
  cc: number,
): number {
  if (sFree === 0) return 0;
  const ve = Math.max(Math.abs(p.vx), V_LOW);
  const k = p.dt * cc;
  const { compound, fz, factor, alpha } = p;
  let a = 0;
  let b = sFree;
  let ga = -sFree;
  let s = sFree / 2;
  for (let i = 0; i < NEWTON_STEPS; i++) {
    const gs = s - sFree + k * fxAt(compound, fz, factor, alpha, s / ve, scratch);
    if (gs === 0) return fxAt(compound, fz, factor, alpha, s / ve, scratch);
    if ((gs > 0) === (ga > 0)) {
      a = s;
      ga = gs;
    } else {
      b = s;
    }
    const h = KAPPA_STEP * ve;
    const slope =
      (fxAt(compound, fz, factor, alpha, (s + h) / ve, scratch) -
        fxAt(compound, fz, factor, alpha, (s - h) / ve, scratch)) /
      (2 * h);
    const dg = 1 + k * slope;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const sn = s - gs / dg;
    s = sn > lo && sn < hi ? sn : (a + b) / 2;
  }
  for (let i = 0; i < BISECT_STEPS; i++) {
    const m = (a + b) / 2;
    if (m === a || m === b) break;
    const gm = m - sFree + k * fxAt(compound, fz, factor, alpha, m / ve, scratch);
    if (gm === 0) return fxAt(compound, fz, factor, alpha, m / ve, scratch);
    if ((gm > 0) === (ga > 0)) {
      a = m;
      ga = gm;
    } else {
      b = m;
    }
  }
  return fxAt(compound, fz, factor, alpha, (a + b) / 2 / ve, scratch);
}

export function solveWheel(p: WheelSolveInput, out: WheelSolveOutput): void {
  const sgn = Math.abs(p.omega) < OMEGA_EPS ? 0 : Math.sign(p.omega);
  const tNet = p.driveTorque - p.brakeTorque * sgn;
  out.omega1 = p.omega + (p.dt / p.inertia) * tNet;
  out.fx = 0;
  out.fy = 0;
  out.locked = false;

  if (p.fz <= 0) {
    if (p.brakeTorque > 0 && p.omega !== 0 && out.omega1 * p.omega < 0) out.omega1 = 0;
    return;
  }

  const ve = Math.max(Math.abs(p.vx), V_LOW);
  const s0 = p.omega * p.r - p.vx;
  const cc = (p.r * p.r) / p.inertia + 1 / p.massShare;
  const sFree = s0 + (p.dt * p.r * tNet) / p.inertia;
  let fxN = solveSlip(p, out, sFree, cc);
  let omega1 = p.omega + (p.dt / p.inertia) * (tNet - p.r * fxN);

  if (p.brakeTorque > 0 && (sgn === 0 || omega1 * p.omega < 0)) {
    const fl = solveSlip(p, out, -p.vx, 1 / p.massShare);
    const net = p.driveTorque - p.r * fl;
    if (Math.abs(net) <= p.brakeTorque) {
      omega1 = 0;
      fxN = fl;
      out.locked = true;
    } else {
      omega1 = (p.dt / p.inertia) * (net - Math.sign(net) * p.brakeTorque);
      fxN = fl;
    }
  }

  const kappa = (omega1 * p.r - p.vx) / ve;
  tyreForces(p.compound, p.fz, kappa, p.alpha, p.factor, out);
  if (fxN * p.vx < 0) {
    const cap = (p.massShare * Math.abs(p.vx)) / p.dt;
    fxN = Math.sign(fxN) * Math.min(Math.abs(fxN), cap);
  }
  out.omega1 = omega1;
  out.fx = fxN;
}

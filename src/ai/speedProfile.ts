import type { CarSpec } from '../physics/carSpec';
import { mengerCurvature, type RacingLine } from './racingLine';

const G = 9.81;
const RHO_HALF = 0.5 * 1.225;
const BACKWARD_ITERS = 4;

export interface CarLimits {
  muLat: number;
  muLong: number;
  /** extra normal accel = aeroK·v² (1/m) */
  aeroK: number;
  /** decel = dragK·v² (1/m) */
  dragK: number;
  /** W/kg */
  powerPerMass: number;
  /** m/s */
  vMax: number;
}

export function cornerSpeed(kappa: number, lim: CarLimits): number {
  const denom = Math.abs(kappa) - lim.muLat * lim.aeroK;
  if (denom <= 0) return lim.vMax;
  const v = Math.sqrt((lim.muLat * G) / denom);
  return v > lim.vMax ? lim.vMax : v;
}

function aG(v: number, kappa: number, lim: CarLimits): number {
  const normal = G + lim.aeroK * v * v;
  const used = (v * v * kappa) / (lim.muLat * normal);
  return lim.muLong * normal * Math.sqrt(Math.max(0, 1 - used * used));
}

function clampV(v: number, vMax: number): number {
  if (!(v > 0)) return 0;
  return v > vMax ? vMax : v;
}

export function speedProfile(line: RacingLine, lim: CarLimits): Float64Array {
  const pts = line.points;
  const n = pts.length / 2;
  if (n < 3) throw new Error('speedProfile: line needs at least 3 points');

  const kappa = new Float64Array(n);
  const ds = new Float64Array(n);
  const corner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ia = (((i - 1) % n) + n) % n;
    const ic = (i + 1) % n;
    kappa[i] = Math.abs(
      mengerCurvature(
        pts[2 * ia], pts[2 * ia + 1],
        pts[2 * i], pts[2 * i + 1],
        pts[2 * ic], pts[2 * ic + 1],
      ),
    );
    ds[i] = Math.hypot(pts[2 * ic] - pts[2 * i], pts[2 * ic + 1] - pts[2 * i + 1]);
    corner[i] = cornerSpeed(kappa[i], lim);
  }

  let seed = 0;
  for (let i = 1; i < n; i++) {
    if (corner[i] < corner[seed]) seed = i;
  }

  const fwd = Float64Array.from(corner);
  const bwd = Float64Array.from(corner);
  for (let t = 1; t <= 2 * n; t++) {
    const i = (((seed + t - 1) % n) + n) % n;
    const j = (seed + t) % n;
    const v = fwd[i];
    const a =
      Math.min(aG(v, kappa[i], lim), lim.powerPerMass / Math.max(v, 1)) -
      lim.dragK * v * v;
    fwd[j] = Math.min(corner[j], clampV(Math.sqrt(Math.max(0, v * v + 2 * a * ds[i])), lim.vMax));
  }
  // Backward: entry speed solves v₁² = v₂² + 2·(a_g(v₁,κ₁)+dragK·v₁²)·ds
  for (let t = 1; t <= 2 * n; t++) {
    const j = (((seed - t + 1) % n) + n) % n;
    const i = (((seed - t) % n) + n) % n;
    const v2 = bwd[j];
    let v1 = v2;
    for (let it = 0; it < BACKWARD_ITERS; it++) {
      const decel = aG(v1, kappa[i], lim) + lim.dragK * v1 * v1;
      v1 = clampV(Math.sqrt(v2 * v2 + 2 * decel * ds[i]), lim.vMax);
    }
    bwd[i] = Math.min(corner[i], v1);
  }

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = clampV(Math.min(corner[i], fwd[i], bwd[i]), lim.vMax);
  }
  return out;
}

export function carLimitsFromSpec(spec: CarSpec, fuelKg: number): CarLimits {
  if (fuelKg < 0) throw new Error('carLimitsFromSpec: fuelKg must be >= 0');
  const m = spec.chassis.massKg + fuelKg;
  const mu = 0.95 * spec.tyres.compounds.medium.mu0;
  const cda = spec.aero.cda;
  let pmax = 0;
  for (const [rpm, torque] of spec.engine.torqueCurve) {
    const p = (torque * rpm * 2 * Math.PI) / 60;
    if (p > pmax) pmax = p;
  }
  return {
    muLat: mu,
    muLong: mu,
    aeroK: (RHO_HALF * (spec.aero.claFront + spec.aero.claRear)) / m,
    dragK: (RHO_HALF * cda) / m,
    powerPerMass: (0.9 * pmax) / m,
    vMax: Math.cbrt((0.9 * pmax) / (RHO_HALF * cda)),
  };
}

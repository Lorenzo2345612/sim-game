import type { TyreCompound } from './carSpec';

export const RELAX = 0.25; // m
export const V_LOW = 1.5; // m/s

export function magic(B: number, C: number, E: number, D: number, s: number): number {
  const bs = B * s;
  return D * Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs))));
}

export function tyreMu(c: TyreCompound, fz: number, factor: number): number {
  return c.mu0 * (1 - (c.loadSens * (fz - c.Fz0)) / c.Fz0) * factor;
}

export function tyreForces(
  c: TyreCompound,
  fz: number,
  kappa: number,
  alpha: number,
  factor: number,
  out: { fx: number; fy: number },
): { fx: number; fy: number } {
  if (fz <= 0) {
    out.fx = 0;
    out.fy = 0;
    return out;
  }
  const D = tyreMu(c, fz, factor) * fz;
  const fx0 = magic(c.Bx, c.Cx, c.Ex, D, kappa);
  const fy0 = magic(c.By, c.Cy, c.Ey, D, alpha);
  if (D !== 0) {
    const e = (fx0 / D) ** 2 + (fy0 / D) ** 2;
    if (e > 1) {
      const k = 1 / Math.sqrt(e);
      out.fx = fx0 * k;
      out.fy = fy0 * k;
      return out;
    }
  }
  out.fx = fx0;
  out.fy = fy0;
  return out;
}

export function relaxAlpha(alpha: number, target: number, vx: number, dt: number): number {
  return alpha + (target - alpha) * (1 - Math.exp((-dt * Math.max(Math.abs(vx), V_LOW)) / RELAX));
}

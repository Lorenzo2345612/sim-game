import { SURFACE_DRAG } from '../core/constants';
import type { Surface } from '../core/types';

// Off-track rolling resistance per wheel: (c0 + c1*|vLong|) * fz, N, >= 0.
export function rollingDrag(surface: Surface, vLong: number, fz: number): number {
  if (!Number.isFinite(vLong) || !Number.isFinite(fz)) return 0;
  const { c0, c1 } = SURFACE_DRAG[surface];
  return (c0 + c1 * Math.abs(vLong)) * Math.max(fz, 0);
}

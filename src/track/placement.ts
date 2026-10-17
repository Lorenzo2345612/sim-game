import type { Grandstand, TrackDataV2 } from '../core/types';
import { footprintGround } from './ground';

export const GRANDSTAND_ROW_DEPTH = 0.9;

export interface Footprint { xMin: number; xMax: number; zMin: number; zMax: number }

/** Local-frame footprint of a stand: length along X, rows × row depth along +Z. */
export function grandstandFootprint(g: Grandstand): Footprint {
  return {
    xMin: -g.lengthMeters / 2,
    xMax: g.lengthMeters / 2,
    zMin: 0,
    zMax: g.rows * GRANDSTAND_ROW_DEPTH,
  };
}

/** Ground the object on the highest ground under its footprint; the plinth bottoms below the lowest. */
export function groundedBase(
  track: TrackDataV2, x: number, z: number, yaw: number, fp: Footprint,
): { baseY: number; plinthBottom: number } {
  const { min, max } = footprintGround(track, x, z, yaw, fp.xMin, fp.xMax, fp.zMin, fp.zMax);
  return { baseY: max, plinthBottom: min - 0.05 };
}

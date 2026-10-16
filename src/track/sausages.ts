import type { Sausage, TrackDataV2, Vec3 } from '../core/types';

export const SAUSAGE_BASE_WIDTH = 0.5;
export const SAUSAGE_TOP_WIDTH = 0.25;
export const SAUSAGE_HEIGHT = 0.13;
export const SAUSAGE_CAP_LENGTH = 0.4;

/** Eight corners (xyz) of the trapezoid prism: base at y 0, top at y SAUSAGE_HEIGHT. */
export function sausageHullPoints(length: number): Float32Array {
  const half = length / 2;
  const bw = SAUSAGE_BASE_WIDTH / 2;
  const tw = SAUSAGE_TOP_WIDTH / 2;
  const h = SAUSAGE_HEIGHT;
  return new Float32Array([
    -bw, 0, -half, bw, 0, -half, bw, 0, half, -bw, 0, half,
    -tw, h, -half, tw, h, -half, tw, h, half, -tw, h, half,
  ]);
}

/** Base centre on the ground at elevation[index], offset along the central-difference right normal; yaw aims local +Z at the tangent. */
export function sausagePose(track: TrackDataV2, s: Sausage): { position: Vec3; yaw: number } {
  const cx = track.centerline;
  const n = cx.length;
  const i = ((s.index % n) + n) % n;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  let dx = next[0] - prev[0];
  let dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    dx = 0;
    dz = -1;
  } else {
    dx /= len;
    dz /= len;
  }
  const sign = s.side === 'right' ? 1 : -1;
  const p = cx[i];
  return {
    position: {
      x: p[0] + -dz * s.offset * sign,
      y: track.elevation[i] ?? 0,
      z: p[1] + dx * s.offset * sign,
    },
    yaw: Math.atan2(dx, dz),
  };
}

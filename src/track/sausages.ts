import type { Sausage, TrackDataV2, Vec3 } from '../core/types';
import { bankTanAt } from './surfaces';

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

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

/** Base centre on the banked surface at elevation[index] + signed offset * tan(bank), along the central-difference right normal; yaw aims local +Z at the tangent. */
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
  const lateral = s.offset * sign;
  const p = cx[i];
  return {
    position: {
      x: p[0] + -dz * lateral,
      y: (track.elevation[i] ?? 0) + lateral * bankTanAt(track, i),
      z: p[1] + dx * lateral,
    },
    yaw: Math.atan2(dx, dz),
  };
}

export interface SausagePiece { position: Vec3; yaw: number; length: number }

/** One-metre pieces along the offset line: arc-centred on the apex index, each on its own centerline segment. */
export function sausagePieces(track: TrackDataV2, s: Sausage): SausagePiece[] {
  const cx = track.centerline;
  const n = cx.length;
  const out: SausagePiece[] = [];
  if (n < 1) return out;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
  }
  const lap = cum[n - 1] + Math.hypot(cx[0][0] - cx[n - 1][0], cx[0][1] - cx[n - 1][1]);
  const count = Math.max(1, Math.ceil(s.length));
  const pieceLength = s.length / count;
  const apex = cum[wrap(s.index, n)];
  const sign = s.side === 'right' ? 1 : -1;
  const lateral = sign * s.offset;
  for (let k = 0; k < count; k++) {
    const a = wrap(apex - s.length / 2 + (k + 0.5) * pieceLength, lap);
    let seg = n - 1;
    for (let j = 0; j < n; j++) {
      const next = j + 1 < n ? cum[j + 1] : lap;
      if (a < next) {
        seg = j;
        break;
      }
    }
    const j = (seg + 1) % n;
    const segEnd = seg + 1 < n ? cum[seg + 1] : lap;
    const segLen = segEnd - cum[seg];
    const t = segLen < 1e-9 ? 0 : (a - cum[seg]) / segLen;
    const ax = cx[seg][0];
    const az = cx[seg][1];
    const rx = cx[j][0] - ax;
    const rz = cx[j][1] - az;
    const rlen = Math.hypot(rx, rz);
    let ux = 0;
    let uz = -1;
    if (rlen >= 1e-9) {
      ux = rx / rlen;
      uz = rz / rlen;
    }
    const elev0 = track.elevation[seg] ?? 0;
    const elev1 = track.elevation[j] ?? 0;
    const bank0 = bankTanAt(track, seg);
    const bank1 = bankTanAt(track, j);
    out.push({
      position: {
        x: ax + t * rx + -uz * lateral,
        y: elev0 + t * (elev1 - elev0) + lateral * (bank0 + t * (bank1 - bank0)),
        z: az + t * rz + ux * lateral,
      },
      yaw: Math.atan2(ux, uz),
      length: pieceLength,
    });
  }
  return out;
}

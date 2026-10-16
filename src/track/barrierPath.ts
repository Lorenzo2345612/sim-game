import type { BarrierSegment, Side, TrackDataV2 } from '../core/types';
import { halfWidthAt } from './surfaces';

export interface BarrierVertex {
  index: number;
  x: number;
  z: number;
  y: number;
  type: BarrierSegment['type'];
}

const NEAR_INDEX_SPAN = 5; // own indices exempt from the cross-track drop test

function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

/** Number of indices covered by a segment: start..end inclusive, wrapping modulo n. */
function segmentCount(seg: BarrierSegment, n: number): number {
  return ((((seg.end - seg.start) % n) + n) % n) + 1;
}

function circularIndexDistance(a: number, b: number, n: number): number {
  const d = Math.abs(a - b) % n;
  return Math.min(d, n - d);
}

/**
 * Maximal sequences of consecutive covered indices (mod n) for one side, in
 * centerline order. A run that wraps starts at its first covered index. If every
 * index is covered the single run starts at index 0 and is closed
 * (run.length === track.centerline.length). Vertices within halfWidthAt + 0.3 m
 * of a centerline point further than NEAR_INDEX_SPAN indices away are dropped
 * (they would cross another track part); the run splits at each drop and pieces
 * under 2 vertices vanish. Median walls on their own narrowed side are exempt.
 */
export function barrierRuns(track: TrackDataV2, side: Side): BarrierVertex[][] {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return [];
  const winner: Array<BarrierSegment | null> = new Array(n).fill(null);
  for (const seg of track.barriers) {
    if (seg.side !== side) continue;
    const count = segmentCount(seg, n);
    for (let k = 0; k < count; k++) {
      winner[(((seg.start + k) % n) + n) % n] = seg;
    }
  }
  const sign = side === 'right' ? 1 : -1;
  const vertexAt = (i: number, seg: BarrierSegment): BarrierVertex => {
    const [rx, rz] = rightNormalAt(cx, i);
    return {
      index: i,
      x: cx[i][0] + sign * seg.offsetMeters * rx,
      z: cx[i][1] + sign * seg.offsetMeters * rz,
      y: track.elevation[i] ?? 0,
      type: seg.type,
    };
  };
  // A median wall sits inside the nominal half-width of its own side (task 155
  // offsets it at half the separation); ordinary barriers are never sub-half-width.
  const isMedianWall = (v: BarrierVertex): boolean => {
    const hw = halfWidthAt(track, side, v.index);
    if (v.type !== 'wall') return false;
    if (hw < track.widthMeters / 2 - 1e-9) return true;
    const [rx, rz] = rightNormalAt(cx, v.index);
    const offset = Math.abs((v.x - cx[v.index][0]) * rx + (v.z - cx[v.index][1]) * rz);
    return offset < hw;
  };
  const reach = new Array<number>(n);
  let maxReach = 0;
  for (let j = 0; j < n; j++) {
    reach[j] = halfWidthAt(track, side, j) + 0.3;
    if (reach[j] > maxReach) maxReach = reach[j];
  }
  const cell = Math.max(maxReach, 1);
  const grid = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const k = `${Math.floor(cx[j][0] / cell)},${Math.floor(cx[j][1] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(j);
    else grid.set(k, [j]);
  }
  const crossesTrack = (v: BarrierVertex): boolean => {
    const gx = Math.floor(v.x / cell);
    const gz = Math.floor(v.z / cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const j of grid.get(`${gx + a},${gz + b}`) ?? []) {
          if (circularIndexDistance(j, v.index, n) <= NEAR_INDEX_SPAN) continue;
          const dx = cx[j][0] - v.x;
          const dz = cx[j][1] - v.z;
          if (dx * dx + dz * dz < reach[j] * reach[j]) return true;
        }
      }
    }
    return false;
  };
  const dropped = (v: BarrierVertex): boolean => !isMedianWall(v) && crossesTrack(v);
  const covered = winner.map((seg) => seg !== null);
  const runs: BarrierVertex[][] = [];
  if (covered.every((c) => c)) {
    const all = Array.from({ length: n }, (_, i) => vertexAt(i, winner[i]!));
    const keep = all.map((v) => !dropped(v));
    if (keep.every((k) => k)) {
      runs.push(all);
      return runs;
    }
    let start = 0;
    while (keep[start]) start = (start + 1) % n;
    let fragment: BarrierVertex[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (keep[i]) fragment.push(all[i]);
      else {
        if (fragment.length >= 2) runs.push(fragment);
        fragment = [];
      }
    }
    return runs;
  }
  for (let i = 0; i < n; i++) {
    if (!covered[i] || covered[(i - 1 + n) % n]) continue;
    const stretch: BarrierVertex[] = [];
    let j = i;
    while (covered[j]) {
      stretch.push(vertexAt(j, winner[j]!));
      j = (j + 1) % n;
      if (j === i) break;
    }
    let anyDrop = false;
    let fragment: BarrierVertex[] = [];
    for (const v of stretch) {
      if (dropped(v)) {
        anyDrop = true;
        if (fragment.length >= 2) runs.push(fragment);
        fragment = [];
      } else {
        fragment.push(v);
      }
    }
    if (!anyDrop) runs.push(stretch);
    else if (fragment.length >= 2) runs.push(fragment);
  }
  return runs;
}

import { KERB_WIDTH } from '../core/constants';
import type { BarrierSegment, Side, TrackDataV2 } from '../core/types';
import { groundHeightAt } from './ground';
import { bankTanAt, cornerCurvature, halfWidthAt } from './surfaces';

export interface BarrierVertex {
  index: number;
  x: number;
  z: number;
  y: number;
  ground: number;
  type: BarrierSegment['type'];
}

const NEAR_INDEX_SPAN = 5; // own indices exempt from the cross-track drop test

export function rightNormalAt(cx: [number, number][], i: number): [number, number] {
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
  const cornerDropped = new Set<BarrierVertex>();
  const clamped = new Set<BarrierVertex>();
  const dataOffset = new Map<BarrierVertex, number>();
  // A median wall sits inside the nominal half-width of its own side (task 155
  // offsets it at half the separation); ordinary barriers are never sub-half-width.
  const isMedianData = (i: number, type: string, offsetMeters: number): boolean => {
    const hw = halfWidthAt(track, side, i);
    return type === 'wall' && (hw < track.widthMeters / 2 - 1e-9 || offsetMeters < hw);
  };
  const vertexAt = (i: number, seg: BarrierSegment): BarrierVertex => {
    const [rx, rz] = rightNormalAt(cx, i);
    const median = isMedianData(i, seg.type, seg.offsetMeters);
    let offset = seg.offsetMeters;
    let cornerDrop = false;
    if (!median) {
      const corner = cornerCurvature(cx, i);
      if (corner && corner.side === side) {
        const cap = 0.8 * corner.radius;
        if (cap < offset) offset = cap;
        cornerDrop = cap < halfWidthAt(track, side, i) + KERB_WIDTH + 0.5;
      }
    }
    const x = cx[i][0] + sign * offset * rx;
    const z = cx[i][1] + sign * offset * rz;
    const y = (track.elevation[i] ?? 0) + sign * offset * bankTanAt(track, i);
    const v: BarrierVertex = {
      index: i,
      x,
      z,
      y,
      ground: track.terrain ? groundHeightAt(track, x, z) : y,
      type: seg.type,
    };
    dataOffset.set(v, seg.offsetMeters);
    if (cornerDrop) cornerDropped.add(v);
    if (!median && offset < seg.offsetMeters) {
      clamped.add(v);
    }
    return v;
  };
  const isMedianWall = (v: BarrierVertex): boolean =>
    isMedianData(v.index, v.type, dataOffset.get(v) ?? 0);
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
  let maxHalf = 0;
  const halfNearAt = new Array<number>(n);
  for (let j = 0; j < n; j++) {
    halfNearAt[j] = Math.min(halfWidthAt(track, 'left', j), halfWidthAt(track, 'right', j));
    maxHalf = Math.max(maxHalf, halfWidthAt(track, 'left', j), halfWidthAt(track, 'right', j));
  }
  const clearCell = Math.max(maxHalf + KERB_WIDTH + 0.5, 1);
  const clearGrid = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const k = `${Math.floor(cx[j][0] / clearCell)},${Math.floor(cx[j][1] / clearCell)}`;
    const list = clearGrid.get(k);
    if (list) list.push(j);
    else clearGrid.set(k, [j]);
  }
  const tooClose = (v: BarrierVertex): boolean => {
    const checkOwn = clamped.has(v);
    const gx = Math.floor(v.x / clearCell);
    const gz = Math.floor(v.z / clearCell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const j of clearGrid.get(`${gx + a},${gz + b}`) ?? []) {
          if (!checkOwn && circularIndexDistance(j, v.index, n) <= NEAR_INDEX_SPAN) continue;
          const t = halfNearAt[j] + KERB_WIDTH + 0.5;
          const dx = cx[j][0] - v.x;
          const dz = cx[j][1] - v.z;
          if (dx * dx + dz * dz < t * t) return true;
        }
      }
    }
    return false;
  };
  const dropped = (v: BarrierVertex): boolean =>
    !isMedianWall(v) && (cornerDropped.has(v) || tooClose(v) || crossesTrack(v));
  const cutBetween = (a: BarrierVertex, b: BarrierVertex): boolean => {
    if (isMedianWall(a) || isMedianWall(b)) return false;
    const exempt = !clamped.has(a) && !clamped.has(b);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const gx = Math.floor(mx / clearCell);
    const gz = Math.floor(mz / clearCell);
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        for (const j of clearGrid.get(`${gx + da},${gz + db}`) ?? []) {
          if (
            exempt &&
            (circularIndexDistance(j, a.index, n) <= NEAR_INDEX_SPAN ||
              circularIndexDistance(j, b.index, n) <= NEAR_INDEX_SPAN)
          )
            continue;
          const t = halfNearAt[j] - 0.3;
          const dx = cx[j][0] - mx;
          const dz = cx[j][1] - mz;
          if (dx * dx + dz * dz < t * t) return true;
        }
      }
    }
    return false;
  };
  const covered = winner.map((seg) => seg !== null);
  const runs: BarrierVertex[][] = [];
  if (covered.every((c) => c)) {
    const all = Array.from({ length: n }, (_, i) => vertexAt(i, winner[i]!));
    const keep = all.map((v) => !dropped(v));
    const cut = all.map((v, i) => keep[i] && keep[(i + 1) % n] && cutBetween(v, all[(i + 1) % n]));
    if (keep.every((k) => k) && !cut.some((c) => c)) {
      runs.push(all);
      return runs;
    }
    let start = 0;
    while (keep[start] && !cut[start]) start = (start + 1) % n;
    let fragment: BarrierVertex[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (keep[i]) fragment.push(all[i]);
      if (!keep[i] || cut[i]) {
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
    for (let q = 0; q < stretch.length; q++) {
      const v = stretch[q];
      if (dropped(v)) {
        anyDrop = true;
        if (fragment.length >= 2) runs.push(fragment);
        fragment = [];
      } else {
        fragment.push(v);
        if (q + 1 < stretch.length && !dropped(stretch[q + 1]) && cutBetween(v, stretch[q + 1])) {
          anyDrop = true;
          if (fragment.length >= 2) runs.push(fragment);
          fragment = [];
        }
      }
    }
    if (!anyDrop) runs.push(stretch);
    else if (fragment.length >= 2) runs.push(fragment);
  }
  return runs;
}

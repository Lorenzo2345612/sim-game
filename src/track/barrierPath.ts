import type { BarrierSegment, Side, TrackDataV2 } from '../core/types';

export interface BarrierVertex {
  index: number;
  x: number;
  z: number;
  y: number;
  type: BarrierSegment['type'];
}

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

/**
 * Maximal sequences of consecutive covered indices (mod n) for one side, in
 * centerline order. A run that wraps starts at its first covered index. If every
 * index is covered the single run starts at index 0 and is closed
 * (run.length === track.centerline.length).
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
  const covered = winner.map((seg) => seg !== null);
  const runs: BarrierVertex[][] = [];
  if (covered.every((c) => c)) {
    runs.push(Array.from({ length: n }, (_, i) => vertexAt(i, winner[i]!)));
    return runs;
  }
  for (let i = 0; i < n; i++) {
    if (!covered[i] || covered[(i - 1 + n) % n]) continue;
    const run: BarrierVertex[] = [];
    let j = i;
    while (covered[j]) {
      run.push(vertexAt(j, winner[j]!));
      j = (j + 1) % n;
      if (j === i) break;
    }
    runs.push(run);
  }
  return runs;
}

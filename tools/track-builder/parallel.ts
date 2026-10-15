import type { Point2 } from '../../src/track/geo';
import { KERB_WIDTH } from '../../src/core/constants';
import type { BarrierSegment, Side, TrackSegment } from '../../src/core/types';

export interface ParallelInfo {
  halfLeft: number[];
  halfRight: number[];
  medianLeft: (number | null)[];
  medianRight: (number | null)[];
  /** Separation to the closest non-adjacent section on that side, clamped to SEP_HORIZON. */
  sepLeft: number[];
  sepRight: number[];
  widthMeters: number;
  any: boolean;
}

const ADJACENT = 60;    // index distance below which two sections count as the same stretch
const SIDE_MARGIN = 6;  // extra metres beyond the width that still narrows the road
const MIN_HALF = 2;     // m, narrowest road half-width
const WALL_GAP = 0.5;   // m kept between the narrowed edge and the median wall
const SEP_HORIZON = 50; // m up to which run-offs are kept clear of the other section

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

export function analyzeParallel(points: Point2[], widthMeters: number): ParallelInfo {
  const n = points.length;
  const half = widthMeters / 2;
  const info: ParallelInfo = {
    halfLeft: new Array<number>(n).fill(half),
    halfRight: new Array<number>(n).fill(half),
    medianLeft: new Array<number | null>(n).fill(null),
    medianRight: new Array<number | null>(n).fill(null),
    sepLeft: new Array<number>(n).fill(SEP_HORIZON),
    sepRight: new Array<number>(n).fill(SEP_HORIZON),
    widthMeters,
    any: false,
  };
  if (n < 3) return info;
  const limit = widthMeters + SIDE_MARGIN;
  const cdist = (a: number, b: number): number => {
    const d = Math.abs(a - b);
    return Math.min(d, n - d);
  };
  for (let i = 0; i < n; i++) {
    const prev = points[wrap(i - 1, n)];
    const next = points[(i + 1) % n];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const len = Math.hypot(tx, tz);
    if (len < 1e-9) {
      tx = 0;
      tz = -1;
    } else {
      tx /= len;
      tz /= len;
    }
    const rx = -tz;
    const rz = tx;
    const px = points[i][0];
    const pz = points[i][1];
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let j = 0; j < n; j++) {
      if (cdist(i, j) <= ADJACENT) continue;
      const j2 = (j + 1) % n;
      if (cdist(i, j2) <= ADJACENT) continue;
      const a = points[j];
      const b = points[j2];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((px - a[0]) * ex + (pz - a[1]) * ez) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = a[0] + ex * t;
      const qz = a[1] + ez * t;
      const d = Math.hypot(px - qx, pz - qz);
      if (d < best) {
        best = d;
        bx = qx;
        bz = qz;
      }
    }
    if (best === Infinity) continue;
    const side: Side = (bx - px) * rx + (bz - pz) * rz > 0 ? 'right' : 'left';
    const sep = Math.min(best, SEP_HORIZON);
    if (side === 'left') info.sepLeft[i] = sep;
    else info.sepRight[i] = sep;
    if (best >= limit) continue;
    const median = Math.floor(best * 2) / 4;
    const narrowed = Math.max(MIN_HALF, Math.min(half, median - WALL_GAP));
    if (side === 'left') {
      info.halfLeft[i] = narrowed;
      info.medianLeft[i] = median;
    } else {
      info.halfRight[i] = narrowed;
      info.medianRight[i] = median;
    }
    info.any = true;
  }
  return info;
}

/**
 * Removes masked indices per side. Kerbs keep exactly the unmasked indices;
 * run-offs are additionally kept clear of the other section wherever their
 * width would reach it (the mask threshold only guards the asphalt), and each
 * kept run-off run is cut one index short of a removed neighbour because
 * segmentRows draws one extra row past each end.
 */
export function stripParallel<T extends TrackSegment>(segs: T[], info: ParallelInfo): T[] {
  const n = info.halfLeft.length;
  if (!info.any || n === 0) return segs;
  const out: T[] = [];
  for (const seg of segs) {
    const masked = seg.side === 'left' ? info.medianLeft : info.medianRight;
    const seps = seg.side === 'left' ? info.sepLeft : info.sepRight;
    const isRunoff = 'widthMeters' in seg;
    // A run-off of width w reaches half + w (+ kerb) and must clear the other
    // road's half-width and kerb: cut while sep < width + w + kerb.
    const reach = isRunoff
      ? info.widthMeters + (seg as { widthMeters: number }).widthMeters + KERB_WIDTH
      : 0;
    const removed = (i: number): boolean => masked[i] !== null || (isRunoff && seps[i] < reach);
    const span = wrap(seg.end - seg.start, n);
    const runs: { start: number; end: number }[] = [];
    let runStart = -1;
    for (let k = 0; k <= span; k++) {
      if (!removed(wrap(seg.start + k, n))) {
        if (runStart < 0) runStart = k;
      } else if (runStart >= 0) {
        runs.push({ start: runStart, end: k - 1 });
        runStart = -1;
      }
    }
    if (runStart >= 0) runs.push({ start: runStart, end: span });
    if (runs.length === 0) continue;
    if (span === n - 1 && runs.length > 1 && runs[0].start === 0 && runs[runs.length - 1].end === span) {
      runs[runs.length - 1].end = runs[0].end;
      runs.shift();
    }
    if (runs.length === 1 && runs[0].start === 0 && runs[0].end === span) {
      out.push(seg);
      continue;
    }
    for (const run of runs) {
      // Only run-offs trim: a kerb row past its end stays inside the narrowed
      // half-width, a run-off row would poke far past the median.
      const trimStart = isRunoff && removed(wrap(seg.start + run.start - 1, n));
      const trimEnd = isRunoff && removed(wrap(seg.start + run.end + 1, n));
      // wrap-aware: the merged run that crosses index 0 has end < start
      const length = wrap(run.end - run.start, n) + 1 - (trimStart ? 1 : 0) - (trimEnd ? 1 : 0);
      if (length < 1) continue;
      out.push({
        ...seg,
        start: wrap(seg.start + run.start + (trimStart ? 1 : 0), n),
        end: wrap(seg.start + run.end - (trimEnd ? 1 : 0), n),
      });
    }
  }
  return out;
}

export function applyMedianWalls(
  barriers: BarrierSegment[],
  info: ParallelInfo,
  n: number,
): BarrierSegment[] {
  if (n < 3 || !info.any || barriers.length === 0) return barriers;
  const medians = [info.medianLeft, info.medianRight];
  const types: (BarrierSegment['type'] | undefined)[][] = [
    new Array<BarrierSegment['type'] | undefined>(n),
    new Array<BarrierSegment['type'] | undefined>(n),
  ];
  const offsets: (number | undefined)[][] = [
    new Array<number | undefined>(n),
    new Array<number | undefined>(n),
  ];
  for (const b of barriers) {
    const slot = b.side === 'left' ? 0 : 1;
    for (let k = 0; k <= wrap(b.end - b.start, n); k++) {
      const i = wrap(b.start + k, n);
      const median = medians[slot][i];
      types[slot][i] = median !== null ? 'wall' : b.type;
      offsets[slot][i] = median !== null ? median : b.offsetMeters;
    }
  }
  const out: BarrierSegment[] = [];
  for (let s = 0; s < 2; s++) {
    const side: Side = s === 0 ? 'left' : 'right';
    const runs: BarrierSegment[] = [];
    for (let i = 0; i < n; i++) {
      const t = types[s][i];
      if (t === undefined) continue;
      const off = offsets[s][i] as number;
      const last = runs[runs.length - 1];
      if (last && last.end === i - 1 && last.type === t && last.offsetMeters === off) {
        last.end = i;
      } else {
        runs.push({ start: i, end: i, side, type: t, offsetMeters: off });
      }
    }
    if (runs.length > 1) {
      const first = runs[0];
      const last = runs[runs.length - 1];
      if (
        first.start === 0 && last.end === n - 1 &&
        first.type === last.type && first.offsetMeters === last.offsetMeters
      ) {
        last.end = first.end;
        runs.shift();
      }
    }
    out.push(...runs);
  }
  return out;
}

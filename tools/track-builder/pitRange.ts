import type { Point2 } from '../../src/track/geo';
import type { PitLane, RunoffSegment } from '../../src/core/types';

const MIN_LENGTH_M = 120;
const SLIDE_LIMIT_M = 600;

function seg(a: Point2, b: Point2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Max distance of the covered points (start..end, inclusive, wrapping) from the start-end chord.
function maxChordDeviation(centerline: Point2[], start: number, end: number): number {
  const a = centerline[start];
  const b = centerline[end];
  const ax = b[0] - a[0];
  const az = b[1] - a[1];
  const len = Math.hypot(ax, az) || 1;
  let max = 0;
  let i = start;
  for (;;) {
    const p = centerline[i];
    const d = Math.abs((p[0] - a[0]) * az - (p[1] - a[1]) * ax) / len;
    if (d > max) max = d;
    if (i === end) break;
    i = (i + 1) % centerline.length;
  }
  return max;
}

function pathLength(centerline: Point2[], start: number, end: number): number {
  let len = 0;
  let i = start;
  while (i !== end) {
    const j = (i + 1) % centerline.length;
    len += seg(centerline[i], centerline[j]);
    i = j;
  }
  return len;
}

// Grow backward/forward from the anchor while the window stays within the
// from/to budgets and the chord deviation stays <= maxChordDevM.
function clipAt(
  centerline: Point2[], anchor: number,
  fromMeters: number, toMeters: number, maxChordDevM: number,
): { start: number; end: number } {
  const n = centerline.length;
  let start = anchor;
  let end = anchor;
  let back = 0;
  let fwd = 0;
  for (;;) {
    const next = (start - 1 + n) % n;
    const step = seg(centerline[next], centerline[start]);
    if (back + step > -fromMeters) break;
    if (maxChordDeviation(centerline, next, end) > maxChordDevM) break;
    start = next;
    back += step;
    if (start === end) break;
  }
  for (;;) {
    const next = (end + 1) % n;
    const step = seg(centerline[end], centerline[next]);
    if (fwd + step > toMeters) break;
    if (maxChordDeviation(centerline, start, next) > maxChordDevM) break;
    end = next;
    fwd += step;
    if (end === start) break;
  }
  return { start, end };
}

/**
 * Pit window around the start line: grows out of `startIndex` within
 * `fromMeters` (<= 0) / `toMeters` (>= 0) while the covered points stay within
 * `maxChordDevM` of the window chord. Slides to a nearby straight when the
 * window would be shorter than 120 m. Indices wrap; start may exceed end.
 */
export function clipPitRange(
  centerline: Point2[], startIndex: number,
  fromMeters: number, toMeters: number, maxChordDevM = 2, context = '',
): { start: number; end: number } {
  const n = centerline.length;
  if (n === 0) throw new Error('clipPitRange: empty centerline');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= n) {
    throw new Error(`clipPitRange(${context}): startIndex ${startIndex} out of range 0..${n - 1}`);
  }

  const hit = clipAt(centerline, startIndex, fromMeters, toMeters, maxChordDevM);
  if (pathLength(centerline, hit.start, hit.end) >= MIN_LENGTH_M) return hit;

  const label = context || `index ${startIndex}`;
  // The start line sits in a curve: search outward (smallest |offset| first)
  // for an anchor whose window reaches the minimum length.
  const candidates: Array<{ index: number; offset: number }> = [];
  let back = 0;
  let fwd = 0;
  for (let d = 1; d < n && Math.min(back, fwd) <= SLIDE_LIMIT_M; d++) {
    const bi = (startIndex - d + n) % n;
    back += seg(centerline[bi], centerline[(bi + 1) % n]);
    if (back <= SLIDE_LIMIT_M) candidates.push({ index: bi, offset: back });
    const fi = (startIndex + d) % n;
    fwd += seg(centerline[(fi - 1 + n) % n], centerline[fi]);
    if (fwd <= SLIDE_LIMIT_M) candidates.push({ index: fi, offset: fwd });
  }
  candidates.sort((a, b) => a.offset - b.offset || a.index - b.index);
  for (const { index, offset } of candidates) {
    const slid = clipAt(centerline, index, fromMeters, toMeters, maxChordDevM);
    if (pathLength(centerline, slid.start, slid.end) >= MIN_LENGTH_M) {
      console.warn(
        `clipPitRange(${label}): start line in a curve; slid pit window ${offset.toFixed(1)} m to index ${index}`,
      );
      return slid;
    }
  }
  throw new Error(
    `clipPitRange(${label}): no straight of >= ${MIN_LENGTH_M} m within ${SLIDE_LIMIT_M} m of index ${startIndex}`,
  );
}

/**
 * Removes pit-side runoffs inside the pit window plus `marginMeters` of arc on
 * either side (closed polyline, closing edge included; `<= margin` inclusive)
 * and splits what remains into its maximal kept runs. Other sides pass through
 * untouched; inputs are not mutated.
 */
export function clipRunoffsOutOfPit(
  runoffs: RunoffSegment[], centerline: Point2[], pit: PitLane, marginMeters: number,
): RunoffSegment[] {
  const n = centerline.length;
  if (pit.start === pit.end) return runoffs;

  const cum = new Array<number>(n + 1);
  cum[0] = 0;
  for (let i = 0; i < n; i++) {
    const a = centerline[i];
    const b = centerline[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const lap = cum[n];
  // Window arc length S..E going forward; outside indices sit on the arc E..S.
  const windowM = (cum[pit.end] - cum[pit.start] + lap) % lap;
  const removed = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const fromStart = (cum[i] - cum[pit.start] + lap) % lap;
    if (fromStart <= windowM) removed[i] = true;
    else removed[i] = Math.min(fromStart - windowM, lap - fromStart) <= marginMeters;
  }

  const out: RunoffSegment[] = [];
  for (const r of runoffs) {
    if (r.side !== pit.side) {
      out.push(r);
      continue;
    }
    const covered: number[] = [];
    let i = ((r.start % n) + n) % n;
    const end = ((r.end % n) + n) % n;
    for (;;) {
      covered.push(i);
      if (i === end) break;
      i = (i + 1) % n;
    }
    covered.sort((a, b) => a - b);
    let runStart = -1;
    let runEnd = -1;
    for (const k of covered) {
      if (removed[k]) {
        if (runStart >= 0) out.push({ ...r, start: runStart, end: runEnd });
        runStart = -1;
      } else {
        if (runStart < 0 || k !== runEnd + 1) {
          if (runStart >= 0) out.push({ ...r, start: runStart, end: runEnd });
          runStart = k;
        }
        runEnd = k;
      }
    }
    if (runStart >= 0) out.push({ ...r, start: runStart, end: runEnd });
  }
  return out;
}

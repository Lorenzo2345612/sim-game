import type { Point2 } from '../../src/track/geo';
import type { RunoffSegment, Side, TrackSegment } from '../../src/core/types';
import { CORNER_RADIUS, KERB_WIDTH } from '../../src/core/constants';

const OFFSET = 5;
const CAP = 1e6;
const KERB_MIN_RUN = 4;   // indices
const KERB_TIGHT = 150;   // m: below this the outside gets an entry kerb too
const GRAVEL_REACH = 40;
const MIN_GRAVEL_RUN = 5;
const MIN_EXTENT = 4;
const MEDIAN_SPLIT = 6;
const FALLBACK_RADIUS = 150;
const GRAVEL_RADIUS = 100;

const wrap = (v: number, n: number) => ((v % n) + n) % n;

export function radii(points: Point2[]): number[] {
  const n = points.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = points[wrap(i - OFFSET, n)];
    const b = points[i];
    const c = points[(i + OFFSET) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const acx = c[0] - a[0];
    const acz = c[1] - a[1];
    const cross = Math.abs(abx * acz - abz * acx);
    if (cross === 0) {
      out[i] = CAP;
      continue;
    }
    const len = Math.hypot(abx, abz) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(acx, acz);
    out[i] = Math.min(len / (2 * cross), CAP);
  }
  return out;
}

function turnSide(points: Point2[], i: number): Side | null {
  const n = points.length;
  const p = points[wrap(i - OFFSET, n)];
  const c = points[i];
  const q = points[(i + OFFSET) % n];
  const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
  if (cross < 0) return 'left';
  if (cross > 0) return 'right';
  return null;
}

export interface CornerRun { start: number; end: number; side: Side; minRadius: number }

function cornerRuns(radiusList: number[], sides: (Side | null)[], threshold: number): CornerRun[] {
  const n = radiusList.length;
  let anchor = 0;
  while (anchor < n && sides[anchor] !== null) anchor++;
  const from = anchor < n ? anchor + 1 : 0;
  const runs: CornerRun[] = [];
  let start = -1;
  let side: Side | null = null;
  let minRadius = Infinity;
  for (let k = from; k < from + n; k++) {
    const i = k % n;
    const s = sides[i];
    if (start >= 0 && s !== null && s === side) {
      if (radiusList[i] < minRadius) minRadius = radiusList[i];
      continue;
    }
    if (start >= 0) runs.push({ start, end: (i - 1 + n) % n, side: side as Side, minRadius });
    start = s !== null && radiusList[i] < threshold ? i : -1;
    side = s;
    minRadius = s !== null ? radiusList[i] : Infinity;
  }
  if (start >= 0) runs.push({ start, end: (from + n - 1) % n, side: side as Side, minRadius });
  return runs;
}

function analyze(points: Point2[], threshold: number): CornerRun[] {
  const r = radii(points);
  const sides = points.map((_, i) => (r[i] < threshold ? turnSide(points, i) : null));
  return cornerRuns(r, sides, threshold);
}

/** Corner runs below CORNER_RADIUS, sorted by start index. */
export function detectCorners(points: Point2[]): CornerRun[] {
  return analyze(points, CORNER_RADIUS).sort((a, b) => a.start - b.start);
}

const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

// Paints [start, start+len) cyclically; len is capped so a kerb longer than the loop covers it all.
function paint(mask: boolean[], n: number, start: number, len: number): void {
  for (let j = 0; j < Math.min(len, n); j++) mask[wrap(start + j, n)] = true;
}

// Maximal painted runs; a mask with no gap is one kerb [0, n-1].
function maskRuns(mask: boolean[], n: number): { start: number; end: number }[] {
  let gap = -1;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) {
      gap = i;
      break;
    }
  }
  if (gap < 0) return [{ start: 0, end: n - 1 }];
  const out: { start: number; end: number }[] = [];
  let start = -1;
  for (let k = 1; k <= n; k++) {
    const i = (gap + k) % n;
    if (mask[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push({ start, end: (i - 1 + n) % n });
      start = -1;
    }
  }
  if (start >= 0) out.push({ start, end: (gap - 1 + n) % n });
  return out;
}

export function detectKerbs(points: Point2[]): TrackSegment[] {
  const n = points.length;
  if (n < 3) return [];
  const mask: Record<Side, boolean[]> = {
    left: new Array<boolean>(n).fill(false),
    right: new Array<boolean>(n).fill(false),
  };
  for (const run of analyze(points, CORNER_RADIUS)) {
    const len = wrap(run.end - run.start, n) + 1;
    if (len < KERB_MIN_RUN) continue;
    paint(mask[run.side], n, run.start - 15, len + 31); // inside: [start-15, end+15]
    paint(mask[opposite(run.side)], n, run.end - 5, 26); // outside exit: [end-5, end+20]
    if (run.minRadius < KERB_TIGHT) paint(mask[opposite(run.side)], n, run.start - 20, 26); // outside entry
  }
  const out: TrackSegment[] = [];
  for (const side of ['left', 'right'] as const) {
    for (const seg of maskRuns(mask[side], n)) out.push({ ...seg, side });
  }
  return out.sort((a, b) => a.start - b.start || (a.side === 'left' ? -1 : 1));
}

function covers(seg: TrackSegment, i: number, n: number): boolean {
  const len = ((seg.end - seg.start) % n + n) % n;
  return ((i - seg.start) % n + n) % n <= len;
}

function rightNormal(points: Point2[], i: number, n: number): Point2 {
  const prev = points[(i - 1 + n) % n];
  const next = points[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

// Parameter of the farthest intersection of segment pq with any polygon edge, or -1.
function farthestCrossing(p: Point2, q: Point2, polygons: Point2[][]): number {
  let best = -1;
  const pqx = q[0] - p[0];
  const pqz = q[1] - p[1];
  for (const ring of polygons) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const d = pqx * (b[1] - a[1]) - pqz * (b[0] - a[0]);
      if (Math.abs(d) < 1e-12) continue;
      const t = ((a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0])) / d;
      const u = ((a[0] - p[0]) * pqz - (a[1] - p[1]) * pqx) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      if (t > best) best = t;
    }
  }
  return best;
}

function gravelExtents(
  points: Point2[], polygons: Point2[][], half: number, kerbs: TrackSegment[], side: Side,
): (number | undefined)[] {
  const n = points.length;
  const sign = side === 'right' ? 1 : -1;
  const out: (number | undefined)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const kerbed = kerbs.some((k) => k.side === side && covers(k, i, n));
    const edge = half + (kerbed ? KERB_WIDTH : 0);
    const [nx, nz] = rightNormal(points, i, n);
    const c = points[i];
    const p: Point2 = [c[0] + nx * sign * edge, c[1] + nz * sign * edge];
    const q: Point2 = [c[0] + nx * sign * (half + GRAVEL_REACH), c[1] + nz * sign * (half + GRAVEL_REACH)];
    const t = farthestCrossing(p, q, polygons);
    if (t < 0) continue;
    out[i] = Math.min(Math.max(t * (half + GRAVEL_REACH - edge), MIN_EXTENT), GRAVEL_REACH);
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface ExtentRun { start: number; end: number; width: number }

function extentRuns(extents: (number | undefined)[], n: number): ExtentRun[] {
  let anchor = 0;
  while (anchor < n && extents[anchor] !== undefined) anchor++;
  const from = anchor < n ? anchor + 1 : 0;
  const runs: ExtentRun[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= MIN_GRAVEL_RUN) {
      runs.push({ start: cur[0], end: cur[cur.length - 1], width: Math.round(median(cur.map((i) => extents[i] as number))) });
    }
    cur = [];
  };
  for (let k = from; k < from + n; k++) {
    const i = k % n;
    const e = extents[i];
    if (e === undefined) {
      flush();
      continue;
    }
    if (cur.length && Math.abs(e - median(cur.map((j) => extents[j] as number))) > MEDIAN_SPLIT) flush();
    cur.push(i);
  }
  flush();
  return runs;
}

function overlapsRange(seg: TrackSegment, start: number, end: number, n: number): boolean {
  const len = ((end - start) % n + n) % n;
  for (let k = 0; k <= len; k++) {
    if (covers(seg, (start + k) % n, n)) return true;
  }
  return false;
}

// OSM coverage counts within the same +-15 index slack the fallback rule grants the corner run.
function osmCovers(osmRuns: RunoffSegment[], side: Side, start: number, end: number, n: number): boolean {
  return osmRuns.some((r) =>
    r.side === side && overlapsRange({ ...r, start: wrap(r.start - 15, n), end: wrap(r.end + 15, n) }, start, end, n));
}

export function detectRunoffs(
  points: Point2[], gravel: Point2[][] = [], halfWidth = 6, kerbs: TrackSegment[] = [],
): RunoffSegment[] {
  const n = points.length;
  if (n === 0) return [];
  const out: RunoffSegment[] = [];
  const osmRuns: RunoffSegment[] = [];
  if (gravel.length) {
    for (const side of ['right', 'left'] as const) {
      const extents = gravelExtents(points, gravel, halfWidth, kerbs, side);
      for (const run of extentRuns(extents, n)) {
        osmRuns.push({ start: run.start, end: run.end, side, surface: 'gravel', widthMeters: run.width });
      }
    }
    out.push(...osmRuns);
  }
  for (const run of analyze(points, CORNER_RADIUS)) {
    if (run.minRadius >= FALLBACK_RADIUS) continue;
    const side = opposite(run.side);
    const start = wrap(run.start - 15, n);
    const end = wrap(run.end + 15, n);
    if (osmCovers(osmRuns, side, start, end, n)) continue;
    const tight = run.minRadius < GRAVEL_RADIUS;
    out.push({
      start,
      end,
      side,
      surface: tight ? 'gravel' : 'runoff',
      widthMeters: tight ? 18 : 12,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

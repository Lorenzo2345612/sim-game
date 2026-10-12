import type { Point2 } from '../../src/track/geo';
import type { RunoffSegment, Side, TrackSegment } from '../../src/core/types';
import { CORNER_RADIUS, KERB_RADIUS } from '../../src/core/constants';

const OFFSET = 5;
const CAP = 1e6;
const MIN_KERB_RUN = 8;

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

interface Run { start: number; end: number; side: Side; minRadius: number }

function cornerRuns(radiusList: number[], sides: (Side | null)[], threshold: number): Run[] {
  const n = radiusList.length;
  let anchor = 0;
  while (anchor < n && sides[anchor] !== null) anchor++;
  const from = anchor < n ? anchor + 1 : 0;
  const runs: Run[] = [];
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

function analyze(points: Point2[], threshold: number): Run[] {
  const r = radii(points);
  const sides = points.map((_, i) => (r[i] < threshold ? turnSide(points, i) : null));
  return cornerRuns(r, sides, threshold);
}

const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

export function detectKerbs(points: Point2[]): TrackSegment[] {
  const n = points.length;
  if (n === 0) return [];
  const out: TrackSegment[] = [];
  for (const run of analyze(points, KERB_RADIUS)) {
    const len = wrap(run.end - run.start, n) + 1;
    if (len < MIN_KERB_RUN) continue;
    const start = wrap(run.start - 10, n);
    const end = wrap(run.end + 10, n);
    out.push({ start, end, side: run.side });
    out.push({ start: wrap(end - 14, n), end, side: opposite(run.side) });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detectRunoffs(points: Point2[]): RunoffSegment[] {
  const n = points.length;
  if (n === 0) return [];
  const out: RunoffSegment[] = [];
  for (const run of analyze(points, CORNER_RADIUS)) {
    const gravel = run.minRadius < 150;
    out.push({
      start: wrap(run.start - 15, n),
      end: wrap(run.end + 15, n),
      side: opposite(run.side),
      surface: gravel ? 'gravel' : 'runoff',
      widthMeters: gravel ? 18 : 12,
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

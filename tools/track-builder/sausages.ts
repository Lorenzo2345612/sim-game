import type { Point2 } from '../../src/track/geo';
import type { Sausage, Side } from '../../src/core/types';
import { KERB_WIDTH } from '../../src/core/constants';
import { detectCorners, radii, type CornerRun } from './corners';

const CHICANE_RADIUS = 80;   // m
const CHICANE_GAP = 120;     // m
const SAUSAGE_LENGTH = 6;    // m
const CLEARANCE = 0.6;       // m beyond the kerb outer edge
const OVERRIDE_SLACK = 3;    // indices: drop an automatic sausage within this of an override

export interface SausageOverride {
  atMeters: number;
  side: Side;
  offsetMeters?: number;
  lengthMeters?: number;
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const circularDistance = (a: number, b: number, n: number) => Math.min(wrap(a - b, n), wrap(b - a, n));

// Forward polyline length along the closed lap from index `from` to `to` (closing edge included).
function arcLength(points: Point2[], from: number, to: number): number {
  const n = points.length;
  let len = 0;
  let i = wrap(from, n);
  const target = wrap(to, n);
  while (i !== target) {
    const j = (i + 1) % n;
    len += Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
    i = j;
  }
  return len;
}

function detectChicanes(points: Point2[], runs: CornerRun[]): [CornerRun, CornerRun][] {
  const out: [CornerRun, CornerRun][] = [];
  for (let i = 0; i < runs.length; i++) {
    const a = runs[i];
    const b = runs[(i + 1) % runs.length];
    if (a.side === b.side) continue;
    if (a.minRadius >= CHICANE_RADIUS || b.minRadius >= CHICANE_RADIUS) continue;
    if (arcLength(points, a.end, b.start) >= CHICANE_GAP) continue;
    out.push([a, b]);
  }
  return out;
}

// Index of the minimum radius inside the run, first index on ties.
function apexIndex(rs: number[], run: CornerRun, n: number): number {
  const span = wrap(run.end - run.start, n);
  let best = run.start;
  let bestR = Infinity;
  for (let k = 0; k <= span; k++) {
    const i = wrap(run.start + k, n);
    if (rs[i] < bestR) {
      bestR = rs[i];
      best = i;
    }
  }
  return best;
}

// Index nearest to an arc length on the closed polyline (wrapping), first index on ties.
function nearestIndexAt(points: Point2[], atMeters: number): number {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const per = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  const target = wrap(atMeters, per);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(cum[i] - target);
    const dist = Math.min(d, per - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}

export function buildSausages(
  points: Point2[], widthMeters: number, overrides?: SausageOverride[],
): Sausage[] {
  const n = points.length;
  if (n < 3) return [];
  const offset = widthMeters / 2 + KERB_WIDTH + CLEARANCE;
  const rs = radii(points);
  const auto: Sausage[] = [];
  const seen = new Set<string>();
  for (const [a, b] of detectChicanes(points, detectCorners(points))) {
    for (const run of [a, b]) {
      const index = apexIndex(rs, run, n);
      const key = `${index}:${run.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      auto.push({ index, side: run.side, offset, length: SAUSAGE_LENGTH });
    }
  }
  const listed: Sausage[] = (overrides ?? []).map((o) => ({
    index: nearestIndexAt(points, o.atMeters),
    side: o.side,
    offset: o.offsetMeters ?? offset,
    length: o.lengthMeters ?? SAUSAGE_LENGTH,
  }));
  const kept = auto.filter(
    (s) => !listed.some((o) => o.side === s.side && circularDistance(o.index, s.index, n) <= OVERRIDE_SLACK),
  );
  return [...listed, ...kept].sort(
    (a, b) => a.index - b.index || (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1),
  );
}

import type { Point2 } from '../../src/track/geo';
import type { Sausage, Side, TrackDataV2 } from '../../src/core/types';
import { KERB_WIDTH } from '../../src/core/constants';
import { sausagePieces } from '../../src/track/sausages';
import { detectCorners, radii, type CornerRun } from './corners';

const CHICANE_RADIUS = 80;   // m
const CHICANE_GAP = 120;     // m
const SAUSAGE_LENGTH = 6;    // m: override default
const MIN_LENGTH = 6;        // m
const MAX_LENGTH = 20;       // m
const CLEARANCE = 0.6;       // m beyond the kerb outer edge
const OVERRIDE_SLACK = 3;    // indices: drop an automatic sausage within this of an override
const FOOTPRINT_MARGIN = 0.1; // m: AT4 clearance beyond KERB_WIDTH
const SHIFT_MARGIN = 0.05;   // m: added on top of the deficit when raising an offset
const ACROSS = [-0.25, 0, 0.25];

export interface SausageOverride {
  atMeters: number;
  side: Side;
  offsetMeters?: number;
  lengthMeters?: number;
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const circularDistance = (a: number, b: number, n: number) => Math.min(wrap(a - b, n), wrap(b - a, n));

// Forward polyline length along the closed lap from index `from` to `to` (closing edge included).
export function arcLength(points: Point2[], from: number, to: number): number {
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
export function apexIndex(rs: number[], run: CornerRun, n: number): number {
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

// AT4 footprint samples (5 along each piece x 3 across the base) against the full
// centerline; returns the worst shortfall of `clearance - (halfNear + KERB + 0.1)`.
function clearanceDeficit(
  track: TrackDataV2, points: Point2[], s: Sausage, widthMeters: number,
  halfWidths?: { left: number[]; right: number[] },
): number {
  let worst = 0;
  for (const piece of sausagePieces(track, s)) {
    const ux = Math.sin(piece.yaw);
    const uz = Math.cos(piece.yaw);
    const nx = -uz;
    const nz = ux;
    for (let j = 0; j < 5; j++) {
      const t = -piece.length / 2 + (piece.length * j) / 4;
      for (const l of ACROSS) {
        const x = piece.position.x + t * ux + l * nx;
        const z = piece.position.z + t * uz + l * nz;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < points.length; i++) {
          const dx = points[i][0] - x;
          const dz = points[i][1] - z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        const halfNear = Math.min(
          halfWidths?.left?.[best] ?? widthMeters / 2,
          halfWidths?.right?.[best] ?? widthMeters / 2,
        );
        const deficit = halfNear + KERB_WIDTH + FOOTPRINT_MARGIN - Math.sqrt(bestD);
        if (deficit > worst) worst = deficit;
      }
    }
  }
  return worst;
}

// AT4 shift-or-drop: raise the offset past the largest deficit once; drop when the
// recheck still fails or the raised offset enters the corner (>= 0.8 * radius).
function applyClearance(
  track: TrackDataV2, points: Point2[], s: Sausage, widthMeters: number,
  rs: number[], halfWidths?: { left: number[]; right: number[] },
): Sausage | null {
  const deficit = clearanceDeficit(track, points, s, widthMeters, halfWidths);
  if (deficit <= 0) return s;
  const shifted: Sausage = { ...s, offset: s.offset + deficit + SHIFT_MARGIN };
  if (shifted.offset >= 0.8 * rs[shifted.index]) return null;
  if (clearanceDeficit(track, points, shifted, widthMeters, halfWidths) > 0) return null;
  return shifted;
}

export function buildSausages(
  points: Point2[], widthMeters: number, overrides?: SausageOverride[],
  halfWidths?: { left: number[]; right: number[] },
): Sausage[] {
  const n = points.length;
  if (n < 3) return [];
  const offset = widthMeters / 2 + KERB_WIDTH + CLEARANCE;
  const rs = radii(points);
  // Flat stand-in: the clearance rule is XZ-only, so elevation/bank do not matter.
  const clearanceTrack = {
    centerline: points,
    elevation: points.map(() => 0),
  } as TrackDataV2;
  const auto: Sausage[] = [];
  const seen = new Set<string>();
  for (const [a, b] of detectChicanes(points, detectCorners(points))) {
    for (const run of [a, b]) {
      const index = apexIndex(rs, run, n);
      const key = `${index}:${run.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const half = halfWidths?.[run.side]?.[index] ?? widthMeters / 2;
      const sausageOffset = half + KERB_WIDTH + CLEARANCE;
      if (sausageOffset >= 0.8 * rs[index]) continue;
      const raw = 0.5 * arcLength(points, run.start, run.end);
      const length = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, raw));
      const fitted = applyClearance(
        clearanceTrack, points, { index, side: run.side, offset: sausageOffset, length },
        widthMeters, rs, halfWidths,
      );
      if (fitted) auto.push(fitted);
    }
  }
  const listed: Sausage[] = [];
  for (const o of overrides ?? []) {
    const fitted = applyClearance(
      clearanceTrack,
      points,
      {
        index: nearestIndexAt(points, o.atMeters),
        side: o.side,
        offset: o.offsetMeters ?? offset,
        length: o.lengthMeters ?? SAUSAGE_LENGTH,
      },
      widthMeters,
      rs,
      halfWidths,
    );
    if (fitted) listed.push(fitted);
  }
  const kept = auto.filter(
    (s) => !listed.some((o) => o.side === s.side && circularDistance(o.index, s.index, n) <= OVERRIDE_SLACK),
  );
  return [...listed, ...kept].sort(
    (a, b) => a.index - b.index || (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1),
  );
}

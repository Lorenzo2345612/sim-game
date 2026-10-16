import type { Point2 } from '../../src/track/geo';
import type { BarrierSegment, EscapeRoad, RunoffSegment, Side, TrackDataV2 } from '../../src/core/types';
import { asphaltOwner, escapeRoadStrips, stripOffenceRows } from '../../src/track/surfaces';
import { detectCorners, type CornerRun } from './corners';

export interface BrakingCorner extends CornerRun { dropKmh: number; kind: 'heavy' | 'medium' | 'none' }

const SPEED_CAP = 85;        // m/s
const APPROACH_DECEL = 12;   // m/s²
const DROP_HEAVY = 70;       // km/h
const DROP_MEDIUM = 40;      // km/h
const HEAVY_RADIUS = 120;    // m
const MEDIUM_RADIUS = 150;   // m
const RUNOFF_BEFORE = 25;    // indices
const RUNOFF_AFTER = 10;     // indices
const FOAM_BEFORE = 15;      // indices
const FOAM_AFTER = 10;       // indices
const FOAM_OFFSET_MAX = 20;  // m: medium corners only foam the close barrier
const ESCAPE_RADIUS = 80;    // m
const ESCAPE_GAP = 120;      // m
const ESCAPE_BEFORE = 10;    // indices
const ESCAPE_WIDTH = 8;      // m
const SAMPLE_STEP = 2;       // m

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

// Forward polyline length from index `from` to `to` (closed lap, closing edge included).
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

function coversIndex(seg: { start: number; end: number }, i: number, n: number): boolean {
  return wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }, n: number): boolean {
  const len = wrap(b.end - b.start, n);
  for (let k = 0; k <= len; k++) {
    if (coversIndex(a, wrap(b.start + k, n), n)) return true;
  }
  return false;
}

// Unit tangent at i, central difference (same scheme as rightNormal in corners.ts).
function tangentAt(points: Point2[], i: number, n: number): Point2 {
  const prev = points[wrap(i - 1, n)];
  const next = points[wrap(i + 1, n)];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [dx / len, dz / len];
}

export function classifyCorners(points: Point2[]): BrakingCorner[] {
  const n = points.length;
  if (n < 3) return [];
  const runs = detectCorners(points);
  if (runs.length === 0) return [];
  return runs.map((run, i) => {
    const prev = runs[(i - 1 + runs.length) % runs.length];
    const vc = Math.min(SPEED_CAP, Math.sqrt(1.6 * 9.81 * run.minRadius));
    const approach = Math.min(SPEED_CAP, Math.sqrt(vc * vc + 2 * APPROACH_DECEL * arcLength(points, prev.end, run.start)));
    const dropKmh = 3.6 * (approach - vc);
    let kind: BrakingCorner['kind'] = 'none';
    if (dropKmh >= DROP_HEAVY && run.minRadius < HEAVY_RADIUS) kind = 'heavy';
    else if (
      (dropKmh >= DROP_MEDIUM && dropKmh < DROP_HEAVY) ||
      (dropKmh >= DROP_HEAVY && run.minRadius >= HEAVY_RADIUS && run.minRadius < MEDIUM_RADIUS)
    ) kind = 'medium';
    return { ...run, dropKmh, kind };
  });
}

export function applyPavedRunoffs(points: Point2[], runoffs: RunoffSegment[], corners: BrakingCorner[]): RunoffSegment[] {
  const n = points.length;
  const work = [...runoffs];
  if (n < 3) return work;
  for (const c of corners) {
    if (c.kind !== 'heavy') continue;
    const side = opposite(c.side);
    const start = wrap(c.start - RUNOFF_BEFORE, n);
    const end = wrap(c.end + RUNOFF_AFTER, n);
    for (let i = work.length - 1; i >= 0; i--) {
      if (work[i].side === side && spansOverlap(work[i], { start, end }, n)) work.splice(i, 1);
    }
    const widthMeters = Math.round(Math.min(Math.max(10 + 0.1 * c.dropKmh, 10), 30) * 2) / 2;
    work.push({ start, end, side, surface: 'runoff', widthMeters });
  }
  return work.sort((a, b) => a.start - b.start);
}

// Laps the barrier/corner indices live on: layoutBarriers covers every index, so max + 1.
function inferLap(barriers: BarrierSegment[], corners: BrakingCorner[]): number {
  let max = -1;
  for (const b of barriers) max = Math.max(max, b.start, b.end);
  for (const c of corners) max = Math.max(max, c.start, c.end);
  return max + 1;
}

export function applyFoamBarriers(barriers: BarrierSegment[], corners: BrakingCorner[]): BarrierSegment[] {
  if (barriers.length === 0) return [];
  const n = inferLap(barriers, corners);
  const types: (BarrierSegment['type'] | undefined)[][] = [[], []];
  const offsets: (number | undefined)[][] = [[], []];
  const sideIdx = (s: Side) => (s === 'left' ? 0 : 1);
  for (const b of barriers) {
    const slot = sideIdx(b.side);
    const len = wrap(b.end - b.start, n);
    for (let k = 0; k <= len; k++) {
      const i = wrap(b.start + k, n);
      types[slot][i] = b.type;
      offsets[slot][i] = b.offsetMeters;
    }
  }
  for (const c of corners) {
    if (c.kind !== 'heavy' && c.kind !== 'medium') continue;
    const slot = sideIdx(opposite(c.side));
    const from = wrap(c.start - FOAM_BEFORE, n);
    const span = wrap(c.end + FOAM_AFTER - from, n);
    for (let k = 0; k <= span; k++) {
      const i = wrap(from + k, n);
      if (types[slot][i] === undefined) continue;
      if (c.kind === 'heavy' || (offsets[slot][i] as number) < FOAM_OFFSET_MAX) types[slot][i] = 'foam';
    }
  }
  const out: BarrierSegment[] = [];
  for (let s = 0; s < 2; s++) {
    const side: Side = s === 0 ? 'left' : 'right';
    const runs: BarrierSegment[] = [];
    for (let i = 0; i < n; i++) {
      const t = types[s][i];
      if (t === undefined) continue;
      const last = runs[runs.length - 1];
      if (last && last.end === i - 1 && last.type === t && last.offsetMeters === offsets[s][i]) {
        last.end = i;
      } else {
        runs.push({ start: i, end: i, side, type: t, offsetMeters: offsets[s][i] as number });
      }
    }
    if (runs.length > 1) {
      const first = runs[0];
      const last = runs[runs.length - 1];
      if (first.start === 0 && last.end === n - 1 && first.type === last.type && first.offsetMeters === last.offsetMeters) {
        last.end = first.end;
        runs.shift();
      }
    }
    out.push(...runs);
  }
  return out;
}

function sampleLeg(a: Point2, b: Point2, out: Point2[]): void {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  out.push([a[0], a[1]]);
  if (len < 1e-9) return;
  for (let d = SAMPLE_STEP; d < len - 1e-9; d += SAMPLE_STEP) {
    out.push([a[0] + (dx * d) / len, a[1] + (dz * d) / len]);
  }
  out.push([b[0], b[1]]);
}

export function detectEscapeRoads(points: Point2[]): EscapeRoad[] {
  const n = points.length;
  if (n < 3) return [];
  const runs = detectCorners(points);
  if (runs.length === 0) return [];
  const out: EscapeRoad[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run1 = runs[i];
    const run2 = runs[(i + 1) % runs.length];
    if (run1.side === run2.side) continue;
    if (run1.minRadius >= ESCAPE_RADIUS || run2.minRadius >= ESCAPE_RADIUS) continue;
    if (arcLength(points, run1.end, run2.start) >= ESCAPE_GAP) continue;
    const aIdx = wrap(run1.start - ESCAPE_BEFORE, n);
    const A = points[aIdx];
    const B = points[wrap(run2.end, n)];
    const T = tangentAt(points, aIdx, n);
    const dot = (B[0] - A[0]) * T[0] + (B[1] - A[1]) * T[1];
    const K: Point2 = [A[0] + T[0] * dot, A[1] + T[1] * dot];
    const road: Point2[] = [];
    sampleLeg(A, K, road);
    const leg2: Point2[] = [];
    sampleLeg(K, B, leg2);
    road.push(...leg2.slice(1));
    out.push({ points: road, width: ESCAPE_WIDTH });
  }
  return out;
}

/**
 * Trims each escape road polyline so its first and last point lie outside the
 * asphalt of every centerline point, and drops whole roads that still cross
 * asphalt between their ends (the road would run over the track).
 */
export function trimEscapeRoads(track: TrackDataV2): { roads: EscapeRoad[]; dropped: number } {
  const owner = asphaltOwner(track);
  const roads: EscapeRoad[] = [];
  let dropped = 0;
  for (const road of track.escapeRoads ?? []) {
    const pts = road.points;
    let a = 0;
    let b = pts.length - 1;
    while (a <= b && owner(pts[a][0], pts[a][1]) !== -1) a++;
    while (b >= a && owner(pts[b][0], pts[b][1]) !== -1) b--;
    const inner = pts.slice(a, b + 1);
    if (
      inner.length < 2 ||
      inner.some((p) => owner(p[0], p[1]) !== -1)
    ) {
      dropped++;
      continue;
    }
    // Escape strips bypass the runtime overlap filter (141 pins them verbatim),
    // so a road may only be stored when its whole strip is clean. Mouth rows
    // that still dip onto the asphalt are trimmed; interior offences drop the road.
    let points = inner;
    let kept = false;
    for (;;) {
      const candidate: EscapeRoad = { points, width: road.width };
      const strip = escapeRoadStrips({ ...track, escapeRoads: [candidate] })[0];
      const offences = strip ? stripOffenceRows(track, strip) : [0];
      if (offences.length === 0) {
        roads.push(candidate);
        kept = true;
        break;
      }
      const head = offences.filter((r) => r <= 1);
      const tail = offences.filter((r) => r >= points.length - 3);
      if (head.length > 0) {
        points = points.slice(Math.max(...head) + 1);
      } else if (tail.length > 0) {
        points = points.slice(0, Math.min(...tail));
      }
      // Interior offences, or mouth trimming that ate the whole road, drop it.
      if (head.length === 0 && tail.length === 0) break;
      if (points.length < 2) break;
    }
    if (!kept) dropped++;
  }
  return { roads, dropped };
}

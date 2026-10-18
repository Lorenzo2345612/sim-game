import type { Point2 } from '../../src/track/geo';
import type { Bollard, BarrierSegment, RunoffSegment, Sausage, Side } from '../../src/core/types';
import { KERB_WIDTH } from '../../src/core/constants';
import { detectCorners, radii, type CornerRun } from './corners';
import { apexIndex } from './sausages';

const DEFAULT_HALF = 6;          // m, halfWidths undefined (tests only)
const GROUP_OUTER = 1.0;         // m beyond the kerb outer edge for R2/R3
const CLEAR_MARGIN = 0.5;        // m beyond the kerb outer edge, minimum clearance
const INNER_CLAMP = 0.8;         // fraction of the corner radius a lateral may reach
const SAUSAGE_STAGGER = [2, 4, 6];   // m downstream of the sausage end
const CORNER_STAGGER = 4;            // m from the middle bollard to each outer one
const MIN_TURN_DEG = 60;
const MAX_TURN_DEG = 120;
const THETA_EPS = 1e-9;      // deg: a fixture corner of exactly 60 deg lands just under in float
const MAX_APEX_RADIUS = 40;      // m
const MIN_RUNOFF_WIDTH = 10;     // m
const SKIP_ARC_M = 15;           // m: same-side R1 bollards this close suppress the group

const wrap = (v: number, n: number): number => ((v % n) + n) % n;
const mod = (v: number, m: number): number => ((v % m) + m) % m;

function covers(seg: { start: number; end: number }, i: number, n: number): boolean {
  return wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);
}

function cumulative(points: Point2[]): { cum: number[]; lap: number } {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

/** Turn angle of a run: absolute sum of signed heading changes from run.start to run.end. */
function thetaDeg(points: Point2[], run: CornerRun): number {
  const n = points.length;
  const span = wrap(run.end - run.start, n);
  let sum = 0;
  for (let k = 0; k < span; k++) {
    const i = wrap(run.start + k, n);
    const j = (i + 1) % n;
    const h1 = Math.atan2(points[j][1] - points[i][1], points[j][0] - points[i][0]);
    const h2 = Math.atan2(points[(j + 1) % n][1] - points[j][1], points[(j + 1) % n][0] - points[j][0]);
    sum += Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
  }
  return Math.abs((sum * 180) / Math.PI);
}

function arcDistance(a: number, b: number, lap: number): number {
  const d = Math.abs(a - b) % lap;
  return Math.min(d, lap - d);
}

// Shortest signed arc difference a - b in (-lap/2, lap/2].
function signedDelta(a: number, b: number, lap: number): number {
  return mod(a - b + lap / 2, lap) - lap / 2;
}

// Index whose arc position is nearest to `arc` on the closed lap, first index on ties.
function nearestIndexAt(cum: number[], lap: number, arc: number): number {
  const target = mod(arc, lap);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cum.length; i++) {
    const d = Math.abs(cum[i] - target);
    const dist = Math.min(d, lap - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}

// Arc position of the closest point of the centerline polyline to (x, z).
function projectArc(cum: number[], points: Point2[], lap: number, x: number, z: number): number {
  const n = points.length;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * Math.sqrt(len2);
    }
  }
  return best % lap;
}

interface Spot { x: number; z: number; nx: number; nz: number }

function nearestSample(points: Point2[], x: number, z: number): { index: number; dist: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - x, points[i][1] - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: bestD };
}

// Linearly interpolated centerline point at an arc position plus its right normal.
function locate(cum: number[], points: Point2[], lap: number, arc: number): Spot {
  const n = points.length;
  const a = mod(arc, lap);
  let i = 0;
  while (i < n - 1 && cum[i + 1] <= a) i++;
  const j = (i + 1) % n;
  const start = i === n - 1 ? cum[n - 1] : cum[i];
  const segLen = i === n - 1 ? lap - cum[n - 1] : cum[i + 1] - cum[i];
  const t = segLen > 0 ? Math.min(1, Math.max(0, (a - start) / segLen)) : 0;
  const ax = points[i][0];
  const az = points[i][1];
  const bx = points[j][0];
  const bz = points[j][1];
  const x = ax + (bx - ax) * t;
  const z = az + (bz - az) * t;
  const tx = segLen > 0 ? (bx - ax) / segLen : 0;
  const tz = segLen > 0 ? (bz - az) / segLen : 0;
  return { x, z, nx: -tz, nz: tx };
}

// groupMinR: the generating run's tightest radius for R2/R3 groups (always inner
// side); null for R1, which clamps against radii[index] when a run covers it.
interface Candidate {
  b: Bollard;
  proj: number;
  lateral: number;
  clearance: number;
  nearIdx: number;
  groupMinR: number | null;
}

export function buildBollards(
  points: Point2[],
  halfWidths: { left: number[]; right: number[] } | undefined,
  sausages: Sausage[],
  runoffs: RunoffSegment[],
  barriers: BarrierSegment[],
): Bollard[] {
  const n = points.length;
  if (n < 3) return [];
  const { cum, lap } = cumulative(points);
  const rs = radii(points);
  const runs = detectCorners(points);
  const half = (side: Side, i: number): number => halfWidths?.[side]?.[i] ?? DEFAULT_HALF;
  const r1: { arc: number; side: Side }[] = [];
  const candidates: Candidate[] = [];

  // Places a bollard at `lateral` metres off the centerline point of the arc whose
  // projection back onto the centerline is `target` (offset points on a curve project
  // onto a neighbouring segment, so the build arc is nudged until the projections match).
  const place = (target0: number, side: Side, lateral: number, groupMinR: number | null = null): Candidate => {
    const target = mod(target0, lap);
    const sign = side === 'right' ? 1 : -1;
    const build = (a: number): { x: number; z: number } => {
      const s = locate(cum, points, lap, a);
      return { x: s.x + sign * lateral * s.nx, z: s.z + sign * lateral * s.nz };
    };
    const proj = (a: number): number => {
      const q = build(a);
      return projectArc(cum, points, lap, q.x, q.z);
    };
    let a = target;
    if (Math.abs(signedDelta(proj(a), target, lap)) > 0.01) {
      let bestA = target;
      let bestE = Infinity;
      let bestD = Infinity;
      const consider = (cand: number): void => {
        const e = Math.abs(signedDelta(proj(cand), target, lap));
        const d = Math.abs(signedDelta(cand, target, lap));
        if (e < bestE - 1e-9 || (Math.abs(e - bestE) <= 1e-9 && d < bestD)) {
          bestE = e;
          bestD = d;
          bestA = cand;
        }
      };
      for (let s = -25; s <= 25; s++) consider(mod(target + s * 0.1, lap));
      for (let s = -10; s <= 10; s++) consider(mod(bestA + s * 0.01, lap));
      a = bestA;
    }
    const p = build(a);
    // Index, clamp and barrier checks use the requested arc, not the nudged build arc.
    const near = nearestSample(points, p.x, p.z);
    candidates.push({
      b: { x: p.x, z: p.z, index: nearestIndexAt(cum, lap, target), side },
      proj: proj(a),
      lateral,
      clearance: near.dist,
      nearIdx: near.index,
      groupMinR,
    });
    return candidates[candidates.length - 1];
  };

  for (const s of sausages) {
    const end = mod(cum[s.index] + s.length / 2, lap);
    for (const gap of SAUSAGE_STAGGER) {
      place(end + gap, s.side, s.offset);
      r1.push({ arc: mod(end + gap, lap), side: s.side });
    }
  }

  for (const run of runs) {
    const apex = apexIndex(rs, run, n);
    const apexArc = cum[apex];
    const inner = run.side;
    const turn = thetaDeg(points, run);
    const r2 =
      turn >= MIN_TURN_DEG - THETA_EPS &&
      turn <= MAX_TURN_DEG + THETA_EPS &&
      run.minRadius <= MAX_APEX_RADIUS;
    const r3 = runoffs.some(
      (r) => r.side === inner && r.widthMeters >= MIN_RUNOFF_WIDTH && covers(r, apex, n),
    );
    if (!r2 && !r3) continue;
    if (r1.some((c) => c.side === inner && arcDistance(c.arc, apexArc, lap) <= SKIP_ARC_M)) continue;
    const lateralAt = (arc: number): number =>
      half(inner, nearestIndexAt(cum, lap, arc)) + KERB_WIDTH + GROUP_OUTER;
    // The outer two target the middle one's projected arc, so the group spacing
    // survives the projection of the inner-offset points back onto the centerline.
    const mid = place(apexArc, inner, lateralAt(apexArc), run.minRadius);
    place(mid.proj - CORNER_STAGGER, inner, lateralAt(mid.proj - CORNER_STAGGER), run.minRadius);
    place(mid.proj + CORNER_STAGGER, inner, lateralAt(mid.proj + CORNER_STAGGER), run.minRadius);
  }

  const kept = candidates.filter((c) => {
    const i = c.b.index;
    const halfNear = Math.min(half('left', c.nearIdx), half('right', c.nearIdx));
    if (c.clearance < halfNear + KERB_WIDTH + CLEAR_MARGIN) return false;
    const wall = barriers
      .filter((b) => b.side === c.b.side && covers(b, i, n))
      .reduce<number | null>((m, b) => (m === null ? b.offsetMeters : Math.min(m, b.offsetMeters)), null);
    if (wall !== null && c.lateral > wall - CLEAR_MARGIN) return false;
    const covering = runs.some((r) => r.side === c.b.side && covers(r, i, n));
    const clampR = c.groupMinR ?? rs[i];
    return !((c.groupMinR !== null || covering) && c.lateral >= INNER_CLAMP * clampR);
  });

  return kept
    .map((c) => c.b)
    .sort((a, b) => cum[a.index] - cum[b.index] || (a.side === b.side ? 0 : a.side === 'left' ? -1 : 1));
}

import { mulberry32 } from '../track-builder/trees';
import type { Building, CityEnv, Wall } from '../../src/core/types';

type P = [number, number];
type Seg = [P, P];

export const VILLAGE_PALETTE: readonly number[] = [
  0xc8963e, 0xe8d8b0, 0xd98c8c, 0xb5553a, 0x8fb8c8, 0xeee8dc, 0x9db37a,
];

export function villageSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface VillageParams {
  centerline: [number, number][];
  halfWidthLeft: number[];
  halfWidthRight: number[];
  streets: [number, number][][];
  mask: [number, number][][];
  exclusions: [number, number][][];
  seed: number;
  /** Metres from the centerline to the house front line per index (both sides when trackSetbackRight is absent). */
  trackSetback?: number[];
  trackSetbackRight?: number[];
}

const STREET_SETBACK = 5.0;
const TRACK_GAP = 2.5;
const FRONT_MIN = 6;
const FRONT_MAX = 14;
const DEPTH_MIN = 9;
const DEPTH_MAX = 16;
const GAP_MIN = 0;
const GAP_MAX = 0.5;
const TALL_SHARE = 0.3;
const TANK_SHARE = 0.4;
const VACANT_SHARE = 0.1;
const HEIGHT_LOW = 3.2;
const HEIGHT_TALL = 6.4;
const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.3;
const JUNCTION_CLEAR = 8;
const ENDPOINT_JUNCTION_DIST = 3;
const OFFSET_STEP_M = 5;
const EPS = 1e-6;

function orient(a: P, b: P, c: P): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function segSegDist(a: P, b: P, c: P, d: P): number {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    pointSegDist(a, c, d),
    pointSegDist(b, c, d),
    pointSegDist(c, a, b),
    pointSegDist(d, a, b),
  );
}

function loopSegments(poly: P[], closed: boolean): Seg[] {
  const segs: Seg[] = [];
  const n = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < n; i++) segs.push([poly[i], poly[(i + 1) % poly.length]]);
  return segs;
}

function segsDist(p: P, segs: Seg[]): number {
  let min = Infinity;
  for (const [a, b] of segs) min = Math.min(min, pointSegDist(p, a, b));
  return min;
}

function segsSegDist(a: P, b: P, segs: Seg[]): number {
  let min = Infinity;
  for (const [c, d] of segs) min = Math.min(min, segSegDist(a, b, c, d));
  return min;
}

function pointInPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointSegDist(p, poly[i], poly[j]) <= 1e-9) return true;
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Interior overlap deeper than tol on every separating axis; touching counts as separated. */
function satOverlap(a: P[], b: P[], tol: number): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const nx = -(q[1] - p[1]);
      const nz = q[0] - p[0];
      const len = Math.hypot(nx, nz);
      if (len === 0) continue;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const v of a) {
        const d = (v[0] * nx + v[1] * nz) / len;
        if (d < aMin) aMin = d;
        if (d > aMax) aMax = d;
      }
      for (const v of b) {
        const d = (v[0] * nx + v[1] * nz) / len;
        if (d < bMin) bMin = d;
        if (d > bMax) bMax = d;
      }
      if (Math.max(bMin - aMax, aMin - bMax) >= -tol) return false;
    }
  }
  return true;
}

function nearestVertexIndex(pts: P[], p: P): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function nearestVertexEdgeIndex(pts: P[], a: P, b: P): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = pointSegDist(pts[i], a, b);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Unit right normal (-dz, dx) at each point; zero-length tangents reuse the previous normal. */
function rightNormals(pts: P[], closed: boolean): P[] {
  const n = pts.length;
  const out: P[] = [];
  let last: P = [0, 1];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(i + 1, n - 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
      last = [-dz, dx];
    }
    out.push([last[0], last[1]]);
  }
  return out;
}

function offsetLine(pts: P[], normals: P[], setback: number[], sign: number): P[] {
  return pts.map((p, i) => [p[0] + normals[i][0] * setback[i] * sign, p[1] + normals[i][1] * setback[i] * sign]);
}

/** Vertex-bisector offsets sag inside the setback at sharp corners of sparse polylines; densify first. */
function densifyPolyline(
  pts: P[],
  closed: boolean,
  maxSeg: number,
  scalars: number[][],
): { pts: P[]; scalars: number[][] } {
  const outPts: P[] = [];
  const outScalars: number[][] = scalars.map(() => []);
  const push = (p: P, s: number[]): void => {
    outPts.push([p[0], p[1]]);
    for (let k = 0; k < s.length; k++) outScalars[k].push(s[k]);
  };
  const n = pts.length;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sa = scalars.map((arr) => arr[i]);
    const sb = scalars.map((arr) => arr[(i + 1) % n]);
    if (i === 0) push(a, sa);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.ceil(len / maxSeg - 1e-9);
    for (let j = 1; j < k; j++) {
      const t = j / k;
      push(
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        sa.map((v, idx) => v + (sb[idx] - v) * t),
      );
    }
    if (!closed || i < edges - 1) push(b, sb);
  }
  return { pts: outPts, scalars: outScalars };
}

interface WalkSeg {
  a: P;
  b: P;
  len: number;
  end: number;
}

interface Walk {
  segs: WalkSeg[];
  total: number;
}

function buildWalk(line: P[], closed: boolean): Walk {
  const segs: WalkSeg[] = [];
  const n = line.length;
  const m = closed ? n : n - 1;
  let end = 0;
  for (let i = 0; i < m; i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    end += len;
    segs.push({ a, b, len, end });
  }
  return { segs, total: end };
}

function pointAtWalk(w: Walk, s: number): { p: P; dir: P } {
  const last = w.segs[w.segs.length - 1];
  const target = Math.min(Math.max(s, 0), w.total);
  for (const seg of w.segs) {
    if (target <= seg.end || seg === last) {
      const start = seg.end - seg.len;
      const t = seg.len > 0 ? Math.min(1, Math.max(0, (target - start) / seg.len)) : 0;
      return {
        p: [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t],
        dir: seg.len > 0 ? [(seg.b[0] - seg.a[0]) / seg.len, (seg.b[1] - seg.a[1]) / seg.len] : [1, 0],
      };
    }
  }
  return { p: [last.b[0], last.b[1]], dir: [1, 0] };
}

function segIntersect(a: P, b: P, c: P, d: P): P[] {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const onSeg = (p: P, q: P, r: P): boolean => {
    if (Math.abs(orient(p, q, r)) > 1e-9) return false;
    return (
      Math.min(p[0], q[0]) - 1e-9 <= r[0] &&
      r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
      Math.min(p[1], q[1]) - 1e-9 <= r[1] &&
      r[1] <= Math.max(p[1], q[1]) + 1e-9
    );
  };
  if (o1 * o2 < 0 && o3 * o4 < 0) {
    const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
    if (Math.abs(den) < 1e-15) return [];
    const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
    return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]];
  }
  const hits: P[] = [];
  if (onSeg(a, b, c)) hits.push([c[0], c[1]]);
  if (onSeg(a, b, d)) hits.push([d[0], d[1]]);
  if (onSeg(c, d, a)) hits.push([a[0], a[1]]);
  if (onSeg(c, d, b)) hits.push([b[0], b[1]]);
  return hits;
}

/** Track-street and street-street crossings, plus street ends within 3 m of another road. */
function findJunctions(centerline: P[], streets: P[][]): P[] {
  const roads: { pts: P[]; closed: boolean }[] = [
    { pts: centerline, closed: true },
    ...streets.map((s) => ({ pts: s, closed: false })),
  ];
  const out: P[] = [];
  const push = (p: P): void => {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) out.push(p);
  };
  for (let i = 1; i < roads.length; i++) {
    for (let j = 0; j < i; j++) {
      const A = loopSegments(roads[i].pts, roads[i].closed);
      const B = loopSegments(roads[j].pts, roads[j].closed);
      for (const [a, b] of A) for (const [c, d] of B) for (const p of segIntersect(a, b, c, d)) push(p);
    }
  }
  for (let i = 1; i < roads.length; i++) {
    const pts = roads[i].pts;
    for (const e of [pts[0], pts[pts.length - 1]]) {
      for (let j = 0; j < roads.length; j++) {
        if (i === j) continue;
        if (segsDist(e, loopSegments(roads[j].pts, roads[j].closed)) <= ENDPOINT_JUNCTION_DIST) {
          push(e);
          break;
        }
      }
    }
  }
  return out;
}

interface PlaceCtx {
  centerline: P[];
  trackSegs: Seg[];
  streetSegs: Seg[][];
  roads: Seg[][];
  setL: number[];
  setR: number[];
  mask: P[][];
  exclusions: P[][];
  junctions: P[];
  buildings: Building[];
  walls: Wall[];
  occupied: P[][];
}

function clearanceAt(ctx: PlaceCtx, p: P, vi: number): number {
  const n = ctx.centerline.length;
  const c = ctx.centerline[vi];
  const prev = ctx.centerline[(vi - 1 + n) % n];
  const next = ctx.centerline[(vi + 1) % n];
  const tx = next[0] - prev[0];
  const tz = next[1] - prev[1];
  const lateral = (p[0] - c[0]) * -tz + (p[1] - c[1]) * tx;
  return lateral >= 0 ? ctx.setR[vi] : ctx.setL[vi];
}

function roadDistAll(p: P, roads: Seg[][]): number {
  let min = Infinity;
  for (const segs of roads) min = Math.min(min, segsDist(p, segs));
  return min;
}

/** The front chord must be no farther from the roads than either side edge, so frontage is the chord. */
function frontIdentifiable(ring: P[], roads: Seg[][]): boolean {
  const avg = (i: number): number =>
    (roadDistAll(ring[i], roads) + roadDistAll(ring[(i + 1) % ring.length], roads)) / 2;
  const front = avg(0);
  return front <= avg(1) && front <= avg(3);
}

function lotAcceptable(ctx: PlaceCtx, ring: P[]): boolean {
  const frontage = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const depth = Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  if (frontage < FRONT_MIN || frontage > FRONT_MAX) return false;
  if (depth < DEPTH_MIN || depth > DEPTH_MAX) return false;
  if (ctx.mask.length > 0 && !ring.every((p) => ctx.mask.some((poly) => pointInPoly(p, poly)))) {
    return false;
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const clearA = clearanceAt(ctx, a, nearestVertexIndex(ctx.centerline, a));
    if (segsDist(a, ctx.trackSegs) < clearA - EPS) return false;
    const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const clearE = clearanceAt(ctx, mid, nearestVertexEdgeIndex(ctx.centerline, a, b));
    if (segsSegDist(a, b, ctx.trackSegs) < clearE - EPS) return false;
    for (const segs of ctx.streetSegs) {
      if (segsDist(a, segs) < STREET_SETBACK - EPS) return false;
      if (segsSegDist(a, b, segs) < STREET_SETBACK - EPS) return false;
    }
  }
  for (const p of ring) {
    for (const j of ctx.junctions) {
      if (Math.hypot(p[0] - j[0], p[1] - j[1]) < JUNCTION_CLEAR) return false;
    }
  }
  if (!frontIdentifiable(ring, ctx.roads)) return false;
  for (const poly of ctx.exclusions) if (satOverlap(ring, poly, EPS)) return false;
  for (const occ of ctx.occupied) if (satOverlap(ring, occ, EPS)) return false;
  return true;
}

function placeOnLine(
  ctx: PlaceCtx,
  line: P[],
  closed: boolean,
  road: Seg[],
  rng: () => number,
): void {
  if (line.length < 2) return;
  const walk = buildWalk(line, closed);
  if (!(walk.total > 0)) return;
  let s = 0;
  while (s < walk.total) {
    const frontage = FRONT_MIN + rng() * (FRONT_MAX - FRONT_MIN);
    const gap = GAP_MIN + rng() * (GAP_MAX - GAP_MIN);
    const depth = DEPTH_MIN + rng() * (DEPTH_MAX - DEPTH_MIN);
    const tall = rng() < TALL_SHARE;
    const color = VILLAGE_PALETTE[Math.floor(rng() * VILLAGE_PALETTE.length)];
    const tank = rng() < TANK_SHARE;
    const vacant = rng() < VACANT_SHARE;
    if (s + frontage > walk.total) break;
    const q0 = pointAtWalk(walk, s);
    const q1 = pointAtWalk(walk, s + frontage);
    const chordLen = Math.hypot(q1.p[0] - q0.p[0], q1.p[1] - q0.p[1]);
    if (chordLen > 0) {
      const fx = (q1.p[0] - q0.p[0]) / chordLen;
      const fz = (q1.p[1] - q0.p[1]) / chordLen;
      const n1: P = [-fz, fx];
      const n2: P = [fz, -fx];
      const mid: P = [(q0.p[0] + q1.p[0]) / 2, (q0.p[1] + q1.p[1]) / 2];
      const away =
        segsDist([mid[0] + n1[0] * depth * 0.5, mid[1] + n1[1] * depth * 0.5], road) >=
        segsDist([mid[0] + n2[0] * depth * 0.5, mid[1] + n2[1] * depth * 0.5], road)
          ? n1
          : n2;
      const ring: P[] = [
        [q0.p[0], q0.p[1]],
        [q1.p[0], q1.p[1]],
        [q1.p[0] + away[0] * depth, q1.p[1] + away[1] * depth],
        [q0.p[0] + away[0] * depth, q0.p[1] + away[1] * depth],
      ];
      if (lotAcceptable(ctx, ring)) {
        ctx.occupied.push(ring);
        if (vacant) {
          ctx.walls.push({
            line: [
              [ring[0][0], ring[0][1]],
              [ring[1][0], ring[1][1]],
            ],
            height: WALL_HEIGHT,
            thickness: WALL_THICKNESS,
          });
        } else {
          const building: Building = {
            ring,
            height: tall ? HEIGHT_TALL : HEIGHT_LOW,
            material: 'plaster',
            color,
          };
          if (tank) building.tank = true;
          ctx.buildings.push(building);
        }
      }
    }
    s += frontage + gap;
  }
}

export function buildVillageEnv(p: VillageParams): CityEnv {
  const rng = mulberry32(p.seed >>> 0);
  const n = p.centerline.length;
  const trackSegs = loopSegments(p.centerline, true);
  const streetSegs = p.streets.map((s) => loopSegments(s, false));
  const setL = p.trackSetback ?? p.halfWidthLeft.map((h) => h + TRACK_GAP);
  const setR =
    p.trackSetbackRight ?? p.trackSetback ?? p.halfWidthRight.map((h) => h + TRACK_GAP);
  const ctx: PlaceCtx = {
    centerline: p.centerline,
    trackSegs,
    streetSegs,
    roads: [trackSegs, ...streetSegs],
    setL,
    setR,
    mask: p.mask,
    exclusions: p.exclusions,
    junctions: findJunctions(p.centerline, p.streets),
    buildings: [],
    walls: [],
    occupied: [],
  };
  if (n >= 2) {
    const dense = densifyPolyline(p.centerline, true, OFFSET_STEP_M, [setL, setR]);
    const normals = rightNormals(dense.pts, true);
    placeOnLine(ctx, offsetLine(dense.pts, normals, dense.scalars[1], 1), true, trackSegs, rng);
    placeOnLine(ctx, offsetLine(dense.pts, normals, dense.scalars[0], -1), true, trackSegs, rng);
  }
  for (const street of p.streets) {
    if (street.length < 2) continue;
    const segs = loopSegments(street, false);
    const dense = densifyPolyline(street, false, OFFSET_STEP_M, []);
    const normals = rightNormals(dense.pts, false);
    const setback = dense.pts.map(() => STREET_SETBACK);
    placeOnLine(ctx, offsetLine(dense.pts, normals, setback, 1), false, segs, rng);
    placeOnLine(ctx, offsetLine(dense.pts, normals, setback, -1), false, segs, rng);
  }
  return { buildings: ctx.buildings, walls: ctx.walls, water: [] };
}

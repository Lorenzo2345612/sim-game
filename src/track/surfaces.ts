import { KERB_WIDTH } from '../core/constants';
import type { Side, Surface, SurfaceStrip, TrackDataV2, TrackSegment } from '../core/types';

const ASPHALT_Y = 0.02;
export const KERB_Y = 0.04;
const RUNOFF_Y = 0.01;
const UV_SCALE = 10;
const KERB_UV_V = 1.5;
const VERGE_FLAT = 6;
const VERGE_SLOPE = 3;
const VERGE_DROP = 0.3;
export const INNER_CURVE_CLAMP = 0.9; // lateral ribbons stay inside this multiple of the corner radius
export const KERB_MIN_WIDTH = 0.4; // clamped inner kerb thinner than this is dropped
export const INNER_ARC_WINDOW = 10; // metres of arc around a row that inherit its corner radii

interface PointIndex {
  cell: number;
  grid: Map<string, number[]>;
}

function buildPointIndex(pts: [number, number][], reach: number[]): PointIndex {
  let maxReach = 0;
  for (const r of reach) if (r > maxReach) maxReach = r;
  const cell = Math.max(maxReach, 1);
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  return { cell, grid };
}

function nearPoints(idx: PointIndex, x: number, z: number, visit: (i: number) => void): void {
  const gx = Math.floor(x / idx.cell);
  const gz = Math.floor(z / idx.cell);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (const i of idx.grid.get(`${gx + a},${gz + b}`) ?? []) visit(i);
    }
  }
}

interface Vertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

/** Right normal of the ring at point i: d = normalize(P[i+1] - P[i-1]), right = (-d.z, d.x). */
function rightNormal(centerline: [number, number][], i: number): [number, number] {
  const n = centerline.length;
  const prev = centerline[(i - 1 + n) % n];
  const next = centerline[(i + 1) % n];
  let dx = next[0] - prev[0];
  let dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) {
    dx = 0;
    dz = -1;
  } else {
    dx /= len;
    dz /= len;
  }
  return [-dz, dx];
}

/** Triangles wind counter-clockwise seen from +Y when columns are ordered by increasing lateral. */
function makeStrip(surface: Surface, rows: Vertex[][], closed: boolean): SurfaceStrip {
  const k = rows.length;
  const w = k > 0 ? rows[0].length : 0;
  const positions = new Float32Array(k * w * 3);
  const uvs = new Float32Array(k * w * 2);
  const span = Math.max(0, w - 1);
  const indices = new Uint32Array(Math.max(0, (closed ? k : k - 1)) * span * 6);
  for (let i = 0; i < k; i++) {
    for (let c = 0; c < w; c++) {
      const t = rows[i][c];
      const p = (i * w + c) * 3;
      positions[p] = t.x;
      positions[p + 1] = t.y;
      positions[p + 2] = t.z;
      const q = (i * w + c) * 2;
      uvs[q] = t.u;
      uvs[q + 1] = t.v;
    }
  }
  let o = 0;
  for (let i = 0; i < (closed ? k : k - 1); i++) {
    const j = closed ? (i + 1) % k : i + 1;
    for (let c = 0; c < span; c++) {
      const a = i * w + c;
      const b = a + 1;
      const d = j * w + c;
      const e = d + 1;
      indices[o++] = a;
      indices[o++] = b;
      indices[o++] = d;
      indices[o++] = b;
      indices[o++] = e;
      indices[o++] = d;
    }
  }
  return { surface, positions, indices, uvs };
}

function normIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Per-index half-width on one side; widthMeters/2 when the arrays are absent. */
export function halfWidthAt(track: TrackDataV2, side: Side, i: number): number {
  const arr = side === 'left' ? track.halfWidthLeft : track.halfWidthRight;
  const v = arr?.[i];
  return v === undefined ? track.widthMeters / 2 : v;
}

/** tan of the per-index cross-slope; 0 when the track has no banking. */
export function bankTanAt(track: TrackDataV2, i: number): number {
  const b = track.bank?.[i];
  return b === undefined || b === 0 ? 0 : Math.tan(b);
}

/**
 * Index of a centerline point whose asphalt contains (x, z): |lateral| <=
 * halfWidthAt - margin (per side) with the projection inside the point's own
 * segment (both ends inclusive); -1 when no asphalt does.
 */
export function asphaltOwner(track: TrackDataV2, margin = 0.5): (x: number, z: number) => number {
  const cx = track.centerline;
  const n = cx.length;
  if (n < 2) return () => -1;
  const eps = 1e-9; // keeps the inclusive bounds inclusive under float64 rounding
  const reach = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const seg = Math.hypot(cx[j][0] - cx[i][0], cx[j][1] - cx[i][1]);
    const half = Math.max(
      halfWidthAt(track, 'left', i) - margin,
      halfWidthAt(track, 'right', i) - margin,
    );
    reach[i] = Math.hypot(seg, Math.max(half, 0)) + eps;
  }
  const index = buildPointIndex(cx, reach);
  return (x, z) => {
    let best = -1;
    nearPoints(index, x, z, (i) => {
      if (best >= 0 && i >= best) return;
      const dx = x - cx[i][0];
      const dz = z - cx[i][1];
      if (dx * dx + dz * dz > reach[i] * reach[i]) return;
      const j = (i + 1) % n;
      const ex = cx[j][0] - cx[i][0];
      const ez = cx[j][1] - cx[i][1];
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-12) return;
      const t = (dx * ex + dz * ez) / l2;
      if (t < -eps || t > 1 + eps) return;
      const len = Math.sqrt(l2);
      const lateral = (dz * ex - dx * ez) / len;
      const half = lateral >= 0 ? halfWidthAt(track, 'right', i) : halfWidthAt(track, 'left', i);
      if (Math.abs(lateral) <= half - margin + eps && (best < 0 || i < best)) best = i;
    });
    return best;
  };
}

/** True when (x, z) lies within min(halfWidthLeft, halfWidthRight) - 1 m of any centerline point. */
function nearAsphaltQuery(track: TrackDataV2): (x: number, z: number) => boolean {
  const cx = track.centerline;
  const n = cx.length;
  if (n < 2) return () => false;
  const reach = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    reach[i] = Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i)) - 1;
  }
  const index = buildPointIndex(cx, reach);
  return (x, z) => {
    let near = false;
    nearPoints(index, x, z, (i) => {
      if (near || reach[i] <= 0) return;
      const dx = x - cx[i][0];
      const dz = z - cx[i][1];
      if (dx * dx + dz * dz <= reach[i] * reach[i]) near = true;
    });
    return near;
  };
}

/** Offset of the last barrier covering (side, i); null when none does. */
function barrierOffsetAt(track: TrackDataV2, side: Side, i: number): number | null {
  const n = track.centerline.length;
  let found: number | null = null;
  for (const b of track.barriers) {
    if (b.side === side && segmentCovers(b, i, n)) found = b.offsetMeters;
  }
  return found;
}

function segmentLength(start: number, end: number, n: number): number {
  return ((end - start + n) % n) + 1;
}

function segmentCovers(seg: TrackSegment, idx: number, n: number): boolean {
  const start = normIndex(seg.start, n);
  const end = normIndex(seg.end, n);
  return ((idx - start + n) % n) < segmentLength(start, end, n);
}

export function hasKerb(track: TrackDataV2, side: Side, i: number): boolean {
  const n = track.centerline.length;
  return track.kerbs.some((k) => k.side === side && segmentCovers(k, i, n));
}

type Lateral = (idx: number) => [latMin: number, latMax: number, u0: number, u1: number];

/**
 * Emit (latMin, latMax) vertex pairs along the ring indices of a segment as maximal
 * runs of kept rows; empty when k < 2. `keep` drops rows without stopping s or v, so
 * surviving rows keep the v they would have had unsplit.
 */
function segmentRows(
  track: TrackDataV2,
  start: number,
  end: number,
  latOf: Lateral,
  yOf: (idx: number, lat: number) => number,
  vScale: number,
  keep?: (idx: number) => boolean,
): Vertex[][][] {
  const cx = track.centerline;
  const n = cx.length;
  const k = segmentLength(start, end, n);
  if (k < 2) return [];
  // One extra row each side covers the band to the neighbouring row; skipped when the
  // segment covers the whole ring or the extension would wrap onto itself (k + 2 > n).
  const ext = k + 2 <= n ? 1 : 0;
  const runs: Vertex[][][] = [];
  let run: Vertex[][] = [];
  let s = 0;
  let s0 = 0;
  const first = normIndex(start - ext, n);
  let prevX = cx[first][0];
  let prevZ = cx[first][1];
  for (let j = 0; j < k + 2 * ext; j++) {
    const idx = normIndex(start - ext + j, n);
    const x = cx[idx][0];
    const z = cx[idx][1];
    if (j > 0) s += Math.hypot(x - prevX, z - prevZ);
    if (j === ext) s0 = s;
    prevX = x;
    prevZ = z;
    if (keep && !keep(idx)) {
      if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      continue;
    }
    const [latMin, latMax, u0, u1] = latOf(idx);
    const [rx, rz] = rightNormal(cx, idx);
    const v = s / vScale;
    run.push([
      { x: x + rx * latMin, y: yOf(idx, latMin), z: z + rz * latMin, u: u0, v },
      { x: x + rx * latMax, y: yOf(idx, latMax), z: z + rz * latMax, u: u1, v },
    ]);
  }
  if (run.length > 0) runs.push(run);
  // Re-base v on the original start row so it stays 0 there and negative on the pre-row.
  const shift = s0 / vScale;
  if (shift !== 0) {
    for (const rows of runs) {
      for (const row of rows) {
        row[0].v -= shift;
        row[1].v -= shift;
      }
    }
  }
  return runs;
}

/** Outermost lateral extent of asphalt, kerbs and runoffs on one side at centerline index i. */
function vergeInnerExtent(track: TrackDataV2, side: Side, i: number): number {
  const n = track.centerline.length;
  const half = halfWidthAt(track, side, i);
  const kerb = track.kerbs.some((k) => k.side === side && segmentCovers(k, i, n));
  let inner = half + (kerb ? KERB_WIDTH : 0);
  for (const seg of track.runoffs) {
    if (seg.side !== side || !segmentCovers(seg, i, n)) continue;
    inner = Math.max(inner, half + (kerb ? KERB_WIDTH : 0) + seg.widthMeters);
  }
  return inner;
}

/** Circumradius of P[i-1], P[i], P[i+1] and the side its centre lies on; null when collinear or degenerate. */
export function cornerCurvature(cx: [number, number][], i: number): { side: Side; radius: number } | null {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const v1x = cx[i][0] - prev[0];
  const v1z = cx[i][1] - prev[1];
  const v2x = next[0] - cx[i][0];
  const v2z = next[1] - cx[i][1];
  const cross = v1x * v2z - v1z * v2x;
  const a = Math.hypot(v1x, v1z);
  const b = Math.hypot(v2x, v2z);
  const c = Math.hypot(v1x + v2x, v1z + v2z);
  if (cross === 0 || a === 0 || b === 0 || c === 0) return null;
  return { side: cross > 0 ? 'right' : 'left', radius: (a * b * c) / (2 * Math.abs(cross)) };
}

/**
 * Per index, the smallest corner radius of each side within INNER_ARC_WINDOW
 * arc distance (wrapping); Infinity where no such corner exists. Precompute
 * once per build so junction and apex-adjacent rows inherit the bend radius.
 */
export function innerCornerRadii(cx: [number, number][]): {
  left: Float64Array;
  right: Float64Array;
} {
  const n = cx.length;
  const left = new Float64Array(n).fill(Infinity);
  const right = new Float64Array(n).fill(Infinity);
  if (n === 0) return { left, right };
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
  }
  const total = s[n - 1] + Math.hypot(cx[0][0] - cx[n - 1][0], cx[0][1] - cx[n - 1][1]);
  for (let j = 0; j < n; j++) {
    const corner = cornerCurvature(cx, j);
    if (corner === null) continue;
    const target = corner.side === 'left' ? left : right;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(s[i] - s[j]);
      if (Math.min(d, total - d) > INNER_ARC_WINDOW) continue;
      if (corner.radius < target[i]) target[i] = corner.radius;
    }
  }
  return { left, right };
}

/** Closed grass verge: inner and flat columns at elev(i), outer column at elev(i) - VERGE_DROP. */
function vergeStrip(track: TrackDataV2, side: Side): SurfaceStrip {
  const cx = track.centerline;
  const n = cx.length;
  const sign = side === 'right' ? 1 : -1;
  const rows: Vertex[][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    let inner = vergeInnerExtent(track, side, i);
    let flat = inner + VERGE_FLAT;
    let outer = flat + VERGE_SLOPE;
    const corner = cornerCurvature(cx, i);
    if (corner !== null && corner.side === side) {
      // Inner side of a corner: keep the verge inside 0.8 x radius of curvature.
      const cap = 0.8 * corner.radius;
      inner = Math.max(halfWidthAt(track, side, i), Math.min(inner, INNER_CURVE_CLAMP * corner.radius));
      flat = Math.max(inner, Math.min(inner + VERGE_FLAT, cap - VERGE_SLOPE));
      outer = Math.max(inner, Math.min(flat + VERGE_SLOPE, cap));
    }
    if (halfWidthAt(track, side, i) < track.widthMeters / 2 - 1e-9) {
      // Narrowed side: the verge stops at the barrier (the shared median wall).
      const cap = barrierOffsetAt(track, side, i);
      if (cap !== null) {
        flat = Math.max(inner, Math.min(flat, cap));
        outer = Math.max(inner, Math.min(outer, cap));
      }
    }
    const y = track.elevation[i] ?? 0;
    const tanB = bankTanAt(track, i);
    const [rx, rz] = rightNormal(cx, i);
    const v = s / UV_SCALE;
    const cols: Vertex[] = [
      { x: cx[i][0] + rx * sign * outer, y: y + sign * outer * tanB - VERGE_DROP, z: cx[i][1] + rz * sign * outer, u: (sign * outer) / UV_SCALE, v },
      { x: cx[i][0] + rx * sign * flat, y: y + sign * flat * tanB, z: cx[i][1] + rz * sign * flat, u: (sign * flat) / UV_SCALE, v },
      { x: cx[i][0] + rx * sign * inner, y: y + sign * inner * tanB, z: cx[i][1] + rz * sign * inner, u: (sign * inner) / UV_SCALE, v },
    ];
    // makeStrip expects columns ordered by increasing lateral.
    if (sign > 0) cols.reverse();
    rows.push(cols);
  }
  return makeStrip('grass', rows, true);
}

/** Unit right lateral at polyline point i: end segments use their own normal, inner points average the adjacent ones. */
function roadLateral(points: [number, number][], i: number): [number, number] {
  const m = points.length;
  const segNormal = (a: number, b: number): [number, number] => {
    let dx = points[b][0] - points[a][0];
    let dz = points[b][1] - points[a][1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) {
      dx = 0;
      dz = -1;
    } else {
      dx /= len;
      dz /= len;
    }
    return [-dz, dx];
  };
  if (m < 2 || i === 0) return segNormal(0, Math.min(1, m - 1));
  if (i === m - 1) return segNormal(m - 2, m - 1);
  const a = segNormal(i - 1, i);
  const b = segNormal(i, i + 1);
  const nx = a[0] + b[0];
  const nz = a[1] + b[1];
  const len = Math.hypot(nx, nz);
  if (len < 1e-9) return a;
  return [nx / len, nz / len];
}

export function escapeRoadStrips(track: TrackDataV2): SurfaceStrip[] {
  const roads = track.escapeRoads;
  if (!roads || roads.length === 0) return [];
  const strips: SurfaceStrip[] = [];
  for (const road of roads) {
    const m = road.points.length;
    if (m < 2) continue;
    const half = road.width / 2;
    const rows: Vertex[][] = [];
    let s = 0;
    for (let i = 0; i < m; i++) {
      if (i > 0) {
        s += Math.hypot(
          road.points[i][0] - road.points[i - 1][0],
          road.points[i][1] - road.points[i - 1][1],
        );
      }
      // Vertex y follows the elevation and cross-slope of the nearest centerline
      // point by XZ distance, at the vertex's signed offset from that centerline.
      let best = 0;
      let bestD2 = Infinity;
      for (let k = 0; k < track.centerline.length; k++) {
        const dx = track.centerline[k][0] - road.points[i][0];
        const dz = track.centerline[k][1] - road.points[i][1];
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = k;
        }
      }
      const [brx, brz] = rightNormal(track.centerline, best);
      const [bx, bz] = track.centerline[best];
      const base = (track.elevation[best] ?? 0) + RUNOFF_Y;
      const tanB = bankTanAt(track, best);
      const [rx, rz] = roadLateral(road.points, i);
      const [x, z] = road.points[i];
      const v = s / UV_SCALE;
      const cols: Array<[number, number, number]> = [
        [x - rx * half, z - rz * half, -half],
        [x + rx * half, z + rz * half, half],
      ];
      rows.push(
        cols.map(([vx, vz, lat]) => ({
          x: vx,
          // Each column lifts by its own signed offset from the centerline.
          y: base + ((vx - bx) * brx + (vz - bz) * brz) * tanB,
          z: vz,
          u: lat / UV_SCALE,
          v,
        })),
      );
    }
    strips.push(rewindToMajority(makeStrip('runoff', rows, false)));
  }
  return strips;
}

/** Re-winds the minority-sign triangles of a strip to its majority winding. */
function rewindToMajority(strip: SurfaceStrip): SurfaceStrip {
  const p = strip.positions;
  const ind = strip.indices;
  let pos = 0;
  let neg = 0;
  for (let k = 0; k + 2 < ind.length; k += 3) {
    const area2 = signedArea2(p, 3 * ind[k], 3 * ind[k + 1], 3 * ind[k + 2]);
    if (area2 > 0) pos++;
    else if (area2 < 0) neg++;
  }
  if (pos === 0 || neg === 0) return strip;
  const majority = pos >= neg ? 1 : -1;
  const out = new Uint32Array(ind);
  for (let k = 0; k + 2 < out.length; k += 3) {
    const area2 = signedArea2(p, 3 * out[k], 3 * out[k + 1], 3 * out[k + 2]);
    if (area2 !== 0 && (area2 > 0 ? 1 : -1) !== majority) {
      const t = out[k + 1];
      out[k + 1] = out[k + 2];
      out[k + 2] = t;
    }
  }
  return { surface: strip.surface, positions: strip.positions, indices: out, uvs: strip.uvs };
}

function signedArea2(p: Float32Array, a: number, b: number, c: number): number {
  return (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
}

/**
 * Drops triangles of a non-asphalt/kerb strip lying on asphalt (centroid or any
 * vertex inside asphaltOwner, or within min half-width - 1 m of a centerline
 * point — segment containment misses fans past hairpin apexes), then every
 * triangle wound against its strip's majority. Returns a new strip, or null
 * when nothing was dropped.
 */
function filterStripTriangles(
  strip: SurfaceStrip,
  owner: (x: number, z: number) => number,
  nearAsphalt: (x: number, z: number) => boolean,
): SurfaceStrip | null {
  const p = strip.positions;
  const ind = strip.indices;
  const count = ind.length / 3;
  const keep = new Uint8Array(count).fill(1);
  const signs = new Int8Array(count);
  const exempt = strip.surface === 'asphalt' || strip.surface === 'kerb';
  let changed = false;
  for (let t = 0; t < count; t++) {
    const a = 3 * ind[3 * t];
    const b = 3 * ind[3 * t + 1];
    const c = 3 * ind[3 * t + 2];
    if (!exempt) {
      const cx3 = (p[a] + p[b] + p[c]) / 3;
      const cz3 = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const onAsphalt =
        owner(cx3, cz3) !== -1 ||
        owner(p[a], p[a + 2]) !== -1 ||
        owner(p[b], p[b + 2]) !== -1 ||
        owner(p[c], p[c + 2]) !== -1 ||
        nearAsphalt(cx3, cz3);
      if (onAsphalt) {
        keep[t] = 0;
        changed = true;
        continue;
      }
    }
    const area2 = signedArea2(p, a, b, c);
    signs[t] = area2 > 0 ? 1 : area2 < 0 ? -1 : 0;
  }
  let pos = 0;
  let neg = 0;
  for (let t = 0; t < count; t++) {
    if (signs[t] > 0) pos++;
    else if (signs[t] < 0) neg++;
  }
  const majority = pos >= neg ? 1 : -1;
  for (let t = 0; t < count; t++) {
    if (keep[t] === 1 && signs[t] !== 0 && signs[t] !== majority) {
      keep[t] = 0;
      changed = true;
    }
  }
  if (!changed) return null;
  const out = new Uint32Array(ind.length);
  let m = 0;
  for (let t = 0; t < count; t++) {
    if (keep[t] === 0) continue;
    out[m++] = ind[3 * t];
    out[m++] = ind[3 * t + 1];
    out[m++] = ind[3 * t + 2];
  }
  return { surface: strip.surface, positions: strip.positions, indices: out.subarray(0, m), uvs: strip.uvs, segment: strip.segment };
}

export function buildTrackSurfaces(track: TrackDataV2): SurfaceStrip[] {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return [];
  const elev = (i: number): number => track.elevation[i] ?? 0;
  const strips: SurfaceStrip[] = [];

  // Asphalt: closed ring, s from point 0.
  const asphaltRows: Vertex[][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const [rx, rz] = rightNormal(cx, i);
    const y = elev(i) + ASPHALT_Y;
    const tanB = bankTanAt(track, i);
    const v = s / UV_SCALE;
    const halfL = halfWidthAt(track, 'left', i);
    const halfR = halfWidthAt(track, 'right', i);
    asphaltRows.push([
      { x: cx[i][0] - rx * halfL, y: y - halfL * tanB, z: cx[i][1] - rz * halfL, u: -halfL / UV_SCALE, v },
      { x: cx[i][0] + rx * halfR, y: y + halfR * tanB, z: cx[i][1] + rz * halfR, u: halfR / UV_SCALE, v },
    ]);
  }
  strips.push(makeStrip('asphalt', asphaltRows, true));

  const reff = innerCornerRadii(cx);
  for (let ki = 0; ki < track.kerbs.length; ki++) {
    const seg = track.kerbs[ki];
    const start = normIndex(seg.start, n);
    const end = normIndex(seg.end, n);
    const sign = seg.side === 'right' ? 1 : -1;
    const uMin = sign > 0 ? 0 : 1;
    const outerOf = (idx: number): number => {
      const half = halfWidthAt(track, seg.side, idx);
      // Inner side of a corner (own row or ±10 m arc neighbour): the kerb may
      // not reach past 0.9 x the neighbourhood's smallest corner radius.
      const near = seg.side === 'left' ? reff.left[idx] : reff.right[idx];
      if (!Number.isFinite(near)) return half + KERB_WIDTH;
      return Math.min(half + KERB_WIDTH, INNER_CURVE_CLAMP * near);
    };
    const runs = segmentRows(
      track,
      start,
      end,
      (idx) => {
        const latInner = sign * halfWidthAt(track, seg.side, idx);
        const latOuter = sign * outerOf(idx);
        return [Math.min(latInner, latOuter), Math.max(latInner, latOuter), uMin, 1 - uMin];
      },
      (idx, lat) => elev(idx) + KERB_Y + lat * bankTanAt(track, idx),
      KERB_UV_V,
      (idx) => outerOf(idx) - halfWidthAt(track, seg.side, idx) >= KERB_MIN_WIDTH,
    );
    for (const rows of runs) {
      if (rows.length >= 2) {
        strips.push({ ...makeStrip('kerb', rows, false), segment: { kind: 'kerb', index: ki } });
      }
    }
  }

  for (let ri = 0; ri < track.runoffs.length; ri++) {
    const seg = track.runoffs[ri];
    const start = normIndex(seg.start, n);
    const end = normIndex(seg.end, n);
    const sign = seg.side === 'right' ? 1 : -1;
    const [rows] = segmentRows(
      track,
      start,
      end,
      (idx) => {
        const pushed = track.kerbs.some((k) => k.side === seg.side && segmentCovers(k, idx, n));
        let inner = sign * (halfWidthAt(track, seg.side, idx) + (pushed ? KERB_WIDTH : 0));
        let outer = inner + sign * seg.widthMeters;
        const corner = cornerCurvature(cx, idx);
        if (corner !== null && corner.side === seg.side) {
          // Inner side of a corner: the column further out cannot pass 0.9 x radius
          // of curvature or the ribbon folds past the corner centre.
          const cap = INNER_CURVE_CLAMP * corner.radius;
          const [near, far] = Math.abs(inner) <= Math.abs(outer) ? [inner, outer] : [outer, inner];
          const limited = Math.sign(far || near || 1) * Math.min(Math.abs(far), cap);
          const capped = Math.abs(limited) < Math.abs(near) ? near : limited;
          if (far === outer) outer = capped;
          else inner = capped;
        }
        const latMin = Math.min(inner, outer);
        const latMax = Math.max(inner, outer);
        return [latMin, latMax, latMin / UV_SCALE, latMax / UV_SCALE];
      },
      (idx, lat) => elev(idx) + RUNOFF_Y + lat * bankTanAt(track, idx),
      UV_SCALE,
    );
    if (rows) strips.push({ ...makeStrip(seg.surface, rows, false), segment: { kind: 'runoff', index: ri } });
  }

  const escapeStrips = escapeRoadStrips(track);
  strips.push(vergeStrip(track, 'left'));
  strips.push(vergeStrip(track, 'right'));
  strips.push(...escapeStrips);

  // Escape strips are appended verbatim (141 pins them against escapeRoadStrips);
  // the builder already trims/drops their polylines so they stay clean.
  const unfiltered = new Set(escapeStrips);
  const owner = asphaltOwner(track);
  const nearAsphalt = nearAsphaltQuery(track);
  for (let i = 0; i < strips.length; i++) {
    if (unfiltered.has(strips[i])) continue;
    const filtered = filterStripTriangles(strips[i], owner, nearAsphalt);
    if (filtered) strips[i] = filtered;
  }
  return strips;
}

/**
 * Rows (2-vertex row index of the strip's leading row) of triangles that dip
 * onto asphalt or park a centroid within min half-width - 1 m of a centerline
 * point. The builder trims escape-road mouths until this comes back empty;
 * interior rows mean the road crosses another track part and is dropped.
 */
export function stripOffenceRows(track: TrackDataV2, strip: SurfaceStrip): number[] {
  const owner = asphaltOwner(track);
  const nearAsphalt = nearAsphaltQuery(track);
  const p = strip.positions;
  const ind = strip.indices;
  const rows: number[] = [];
  for (let t = 0; t + 2 < ind.length; t += 3) {
    const a = 3 * ind[t];
    const b = 3 * ind[t + 1];
    const c = 3 * ind[t + 2];
    const x = (p[a] + p[b] + p[c]) / 3;
    const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (
      owner(x, z) !== -1 ||
      owner(p[a], p[a + 2]) !== -1 ||
      owner(p[b], p[b + 2]) !== -1 ||
      owner(p[c], p[c + 2]) !== -1 ||
      nearAsphalt(x, z)
    ) {
      rows.push(Math.floor(t / 6));
    }
  }
  return rows;
}

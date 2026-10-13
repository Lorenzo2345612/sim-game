import { KERB_WIDTH } from '../core/constants';
import type { Side, Surface, SurfaceStrip, TrackDataV2, TrackSegment } from '../core/types';

const ASPHALT_Y = 0.02;
const KERB_Y = 0.04;
const RUNOFF_Y = 0.01;
const UV_SCALE = 10;
const KERB_UV_V = 1.5;
const VERGE_FLAT = 6;
const VERGE_SLOPE = 3;
const VERGE_DROP = 0.3;

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

function segmentLength(start: number, end: number, n: number): number {
  return ((end - start + n) % n) + 1;
}

function segmentCovers(seg: TrackSegment, idx: number, n: number): boolean {
  const start = normIndex(seg.start, n);
  const end = normIndex(seg.end, n);
  return ((idx - start + n) % n) < segmentLength(start, end, n);
}

type Lateral = (idx: number) => [latMin: number, latMax: number, u0: number, u1: number];

/** Emit (latMin, latMax) vertex pairs along the ring indices of a segment; empty when k < 2. */
function segmentRows(
  track: TrackDataV2,
  start: number,
  end: number,
  latOf: Lateral,
  yOf: (idx: number) => number,
  vScale: number,
): Vertex[][] {
  const cx = track.centerline;
  const n = cx.length;
  const k = segmentLength(start, end, n);
  if (k < 2) return [];
  // One extra row each side covers the band to the neighbouring row; skipped when the
  // segment covers the whole ring or the extension would wrap onto itself (k + 2 > n).
  const ext = k + 2 <= n ? 1 : 0;
  const rows: Vertex[][] = [];
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
    const [latMin, latMax, u0, u1] = latOf(idx);
    const [rx, rz] = rightNormal(cx, idx);
    const y = yOf(idx);
    const v = s / vScale;
    rows.push([
      { x: x + rx * latMin, y, z: z + rz * latMin, u: u0, v },
      { x: x + rx * latMax, y, z: z + rz * latMax, u: u1, v },
    ]);
  }
  // Re-base v on the original start row so it stays 0 there and negative on the pre-row.
  const shift = s0 / vScale;
  if (shift !== 0) {
    for (const row of rows) {
      row[0].v -= shift;
      row[1].v -= shift;
    }
  }
  return rows;
}

/** Outermost lateral extent of asphalt, kerbs and runoffs on one side at centerline index i. */
function vergeInnerExtent(track: TrackDataV2, side: Side, i: number): number {
  const n = track.centerline.length;
  const half = track.widthMeters / 2;
  const kerb = track.kerbs.some((k) => k.side === side && segmentCovers(k, i, n));
  let inner = half + (kerb ? KERB_WIDTH : 0);
  for (const seg of track.runoffs) {
    if (seg.side !== side || !segmentCovers(seg, i, n)) continue;
    inner = Math.max(inner, half + (kerb ? KERB_WIDTH : 0) + seg.widthMeters);
  }
  return inner;
}

/** Circumradius of P[i-1], P[i], P[i+1] and the side its centre lies on; null when collinear or degenerate. */
function cornerCurvature(cx: [number, number][], i: number): { side: Side; radius: number } | null {
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

/** Closed grass verge: inner and flat columns at elev(i), outer column at elev(i) - VERGE_DROP. */
function vergeStrip(track: TrackDataV2, side: Side): SurfaceStrip {
  const cx = track.centerline;
  const n = cx.length;
  const sign = side === 'right' ? 1 : -1;
  const rows: Vertex[][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const inner = vergeInnerExtent(track, side, i);
    let flat = inner + VERGE_FLAT;
    let outer = flat + VERGE_SLOPE;
    const corner = cornerCurvature(cx, i);
    if (corner !== null && corner.side === side) {
      // Inner side of a corner: keep the verge inside 0.8 x radius of curvature.
      const cap = 0.8 * corner.radius;
      flat = Math.max(inner, Math.min(inner + VERGE_FLAT, cap - VERGE_SLOPE));
      outer = Math.max(inner, Math.min(flat + VERGE_SLOPE, cap));
    }
    const y = track.elevation[i] ?? 0;
    const [rx, rz] = rightNormal(cx, i);
    const v = s / UV_SCALE;
    const cols: Vertex[] = [
      { x: cx[i][0] + rx * sign * outer, y: y - VERGE_DROP, z: cx[i][1] + rz * sign * outer, u: (sign * outer) / UV_SCALE, v },
      { x: cx[i][0] + rx * sign * flat, y, z: cx[i][1] + rz * sign * flat, u: (sign * flat) / UV_SCALE, v },
      { x: cx[i][0] + rx * sign * inner, y, z: cx[i][1] + rz * sign * inner, u: (sign * inner) / UV_SCALE, v },
    ];
    // makeStrip expects columns ordered by increasing lateral.
    if (sign > 0) cols.reverse();
    rows.push(cols);
  }
  return makeStrip('grass', rows, true);
}

export function buildTrackSurfaces(track: TrackDataV2): SurfaceStrip[] {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return [];
  const half = track.widthMeters / 2;
  const elev = (i: number): number => track.elevation[i] ?? 0;
  const strips: SurfaceStrip[] = [];

  // Asphalt: closed ring, s from point 0.
  const asphaltRows: Vertex[][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const [rx, rz] = rightNormal(cx, i);
    const y = elev(i) + ASPHALT_Y;
    const v = s / UV_SCALE;
    asphaltRows.push([
      { x: cx[i][0] - rx * half, y, z: cx[i][1] - rz * half, u: -half / UV_SCALE, v },
      { x: cx[i][0] + rx * half, y, z: cx[i][1] + rz * half, u: half / UV_SCALE, v },
    ]);
  }
  strips.push(makeStrip('asphalt', asphaltRows, true));

  for (const seg of track.kerbs) {
    const start = normIndex(seg.start, n);
    const end = normIndex(seg.end, n);
    const sign = seg.side === 'right' ? 1 : -1;
    const latInner = sign * half;
    const latOuter = sign * (half + KERB_WIDTH);
    const uMin = sign > 0 ? 0 : 1;
    const rows = segmentRows(
      track,
      start,
      end,
      () => [Math.min(latInner, latOuter), Math.max(latInner, latOuter), uMin, 1 - uMin],
      (idx) => elev(idx) + KERB_Y,
      KERB_UV_V,
    );
    if (rows.length > 0) strips.push(makeStrip('kerb', rows, false));
  }

  for (const seg of track.runoffs) {
    const start = normIndex(seg.start, n);
    const end = normIndex(seg.end, n);
    const sign = seg.side === 'right' ? 1 : -1;
    const rows = segmentRows(
      track,
      start,
      end,
      (idx) => {
        const pushed = track.kerbs.some((k) => k.side === seg.side && segmentCovers(k, idx, n));
        const inner = sign * (half + (pushed ? KERB_WIDTH : 0));
        const outer = inner + sign * seg.widthMeters;
        const latMin = Math.min(inner, outer);
        const latMax = Math.max(inner, outer);
        return [latMin, latMax, latMin / UV_SCALE, latMax / UV_SCALE];
      },
      (idx) => elev(idx) + RUNOFF_Y,
      UV_SCALE,
    );
    if (rows.length > 0) strips.push(makeStrip(seg.surface, rows, false));
  }

  strips.push(vergeStrip(track, 'left'));
  strips.push(vergeStrip(track, 'right'));

  return strips;
}

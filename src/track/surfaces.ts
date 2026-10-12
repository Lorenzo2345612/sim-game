import { KERB_WIDTH } from '../core/constants';
import type { Surface, SurfaceStrip, TrackDataV2, TrackSegment } from '../core/types';

const ASPHALT_Y = 0.02;
const KERB_Y = 0.04;
const RUNOFF_Y = 0.01;
const UV_SCALE = 10;
const KERB_UV_V = 1.5;

interface Row {
  x0: number;
  y: number;
  z0: number;
  u0: number;
  v: number;
  x1: number;
  z1: number;
  u1: number;
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

/** Triangles wind counter-clockwise seen from +Y for both sides and any lateral range. */
function makeStrip(surface: Surface, rows: Row[], closed: boolean): SurfaceStrip {
  const k = rows.length;
  const positions = new Float32Array(k * 6);
  const uvs = new Float32Array(k * 4);
  const quads = closed ? k : k - 1;
  const indices = new Uint32Array(quads * 6);
  for (let i = 0; i < k; i++) {
    const r = rows[i];
    const p = i * 6;
    positions[p] = r.x0;
    positions[p + 1] = r.y;
    positions[p + 2] = r.z0;
    positions[p + 3] = r.x1;
    positions[p + 4] = r.y;
    positions[p + 5] = r.z1;
    const t = i * 4;
    uvs[t] = r.u0;
    uvs[t + 1] = r.v;
    uvs[t + 2] = r.u1;
    uvs[t + 3] = r.v;
  }
  for (let i = 0; i < quads; i++) {
    const j = closed ? (i + 1) % k : i + 1;
    const o = i * 6;
    indices[o] = 2 * i;
    indices[o + 1] = 2 * i + 1;
    indices[o + 2] = 2 * j;
    indices[o + 3] = 2 * i + 1;
    indices[o + 4] = 2 * j + 1;
    indices[o + 5] = 2 * j;
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
): Row[] {
  const cx = track.centerline;
  const n = cx.length;
  const k = segmentLength(start, end, n);
  if (k < 2) return [];
  const rows: Row[] = [];
  let s = 0;
  let prevX = cx[start][0];
  let prevZ = cx[start][1];
  for (let j = 0; j < k; j++) {
    const idx = (start + j) % n;
    const x = cx[idx][0];
    const z = cx[idx][1];
    if (j > 0) s += Math.hypot(x - prevX, z - prevZ);
    prevX = x;
    prevZ = z;
    const [latMin, latMax, u0, u1] = latOf(idx);
    const [rx, rz] = rightNormal(cx, idx);
    rows.push({
      x0: x + rx * latMin,
      y: yOf(idx),
      z0: z + rz * latMin,
      u0,
      v: s / vScale,
      x1: x + rx * latMax,
      z1: z + rz * latMax,
      u1,
    });
  }
  return rows;
}

export function buildTrackSurfaces(track: TrackDataV2): SurfaceStrip[] {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return [];
  const half = track.widthMeters / 2;
  const elev = (i: number): number => track.elevation[i] ?? 0;
  const strips: SurfaceStrip[] = [];

  // Asphalt: closed ring, s from point 0.
  const asphaltRows: Row[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const [rx, rz] = rightNormal(cx, i);
    asphaltRows.push({
      x0: cx[i][0] - rx * half,
      y: elev(i) + ASPHALT_Y,
      z0: cx[i][1] - rz * half,
      u0: -half / UV_SCALE,
      v: s / UV_SCALE,
      x1: cx[i][0] + rx * half,
      z1: cx[i][1] + rz * half,
      u1: half / UV_SCALE,
    });
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

  return strips;
}

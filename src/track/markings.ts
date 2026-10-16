import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
import { bankTanAt, halfWidthAt } from './surfaces';

const MARKING_Y = 0.025;
const EDGE_WIDTH = 0.12;
const START_LENGTH = 0.6;
const UV_SCALE = 10;

interface Vertex {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

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

/** Same winding rule as surfaces.ts: CCW from +Y when columns order by increasing lateral. */
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

function edgeLine(track: TrackDataV2, sign: 1 | -1): SurfaceStrip {
  const cx = track.centerline;
  const n = cx.length;
  const side = sign > 0 ? 'right' : 'left';
  const rows: Vertex[][] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
    const half = halfWidthAt(track, side, i);
    const inner = half - EDGE_WIDTH;
    // Columns ordered by increasing lateral for consistent winding.
    const lats = sign > 0 ? [inner, half] : [-half, -inner];
    const [rx, rz] = rightNormal(cx, i);
    const y = (track.elevation[i] ?? 0) + MARKING_Y;
    const tanB = bankTanAt(track, i);
    const v = s / UV_SCALE;
    rows.push(
      lats.map((lat) => ({
        x: cx[i][0] + rx * lat,
        y: y + lat * tanB,
        z: cx[i][1] + rz * lat,
        u: lat / UV_SCALE,
        v,
      })),
    );
  }
  return makeStrip('asphalt', rows, true);
}

function startLine(track: TrackDataV2): SurfaceStrip {
  const cx = track.centerline;
  const half = track.widthMeters / 2;
  const segLen = Math.hypot(cx[1][0] - cx[0][0], cx[1][1] - cx[0][1]);
  // Clamp keeps the row on the first segment even if a centerline point is closer than 0.6 m.
  const t = segLen < 1e-9 ? 0 : Math.min(START_LENGTH / segLen, 1);
  const x = cx[0][0] + (cx[1][0] - cx[0][0]) * t;
  const z = cx[0][1] + (cx[1][1] - cx[0][1]) * t;
  const [rx, rz] = rightNormal(cx, 0);
  const y = (track.elevation[0] ?? 0) + MARKING_Y;
  // Both rows belong to index 0, so they share its cross-slope; the advanced row
  // measures d from its own position, projected on the index-0 normal.
  const tanB = bankTanAt(track, 0);
  const rows: Vertex[][] = [
    [-half, half].map((lat) => ({ x: cx[0][0] + rx * lat, y: y + lat * tanB, z: cx[0][1] + rz * lat, u: lat / UV_SCALE, v: 0 })),
    [-half, half].map((lat) => {
      const vx = x + rx * lat;
      const vz = z + rz * lat;
      const d = (vx - cx[0][0]) * rx + (vz - cx[0][1]) * rz;
      return { x: vx, y: y + d * tanB, z: vz, u: lat / UV_SCALE, v: START_LENGTH / UV_SCALE };
    }),
  ];
  return makeStrip('asphalt', rows, false);
}

export function buildTrackMarkings(track: TrackDataV2): SurfaceStrip[] {
  if (track.centerline.length === 0) return [];
  return [edgeLine(track, -1), edgeLine(track, 1), startLine(track)];
}

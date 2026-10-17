import type { Terrain, TrackDataV2 } from '../core/types';
import { bankTanAt } from './surfaces';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Bilinear sample of the terrain grid; heights are column-major (col * (rows + 1) + row), coordinates clamped. */
export function terrainHeightAt(t: Terrain, x: number, z: number): number {
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  const fx = clamp(((x - minX) / t.sizeX) * t.cols, 0, t.cols);
  const fz = clamp(((z - minZ) / t.sizeZ) * t.rows, 0, t.rows);
  const j = Math.min(Math.floor(fx), t.cols - 1);
  const i = Math.min(Math.floor(fz), t.rows - 1);
  const tx = fx - j;
  const tz = fz - i;
  const h00 = t.heights[j * vertexRows + i];
  const h10 = t.heights[(j + 1) * vertexRows + i];
  const h01 = t.heights[j * vertexRows + i + 1];
  const h11 = t.heights[(j + 1) * vertexRows + i + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

/** Ground height of a trackside point: centerline elevation plus its cross-slope at the signed lateral offset. */
function planeHeightAt(track: TrackDataV2, x: number, z: number): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < track.centerline.length; i++) {
    const dx = track.centerline[i][0] - x;
    const dz = track.centerline[i][1] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  const n = track.centerline.length;
  const prev = track.centerline[(best - 1 + n) % n];
  const next = track.centerline[(best + 1) % n];
  const tx = next[0] - prev[0];
  const tz = next[1] - prev[1];
  const len = Math.hypot(tx, tz) || 1;
  const lat = ((x - track.centerline[best][0]) * -tz + (z - track.centerline[best][1]) * tx) / len;
  return (track.elevation[best] ?? 0) + lat * bankTanAt(track, best);
}

/** Terrain height when the track has terrain and the sample is finite, else the track-plane height. */
export function groundHeightAt(track: TrackDataV2, x: number, z: number): number {
  if (track.terrain) {
    const h = terrainHeightAt(track.terrain, x, z);
    if (Number.isFinite(h)) return h;
  }
  return planeHeightAt(track, x, z);
}

/**
 * Min/max groundHeightAt over a local box mapped to world by three.js rotation.y = yaw:
 * local (lx, lz) -> (x + lx·cos yaw + lz·sin yaw, z − lx·sin yaw + lz·cos yaw).
 */
export function footprintGround(
  track: TrackDataV2, x: number, z: number, yaw: number,
  xMin: number, xMax: number, zMin: number, zMax: number, step = 2,
): { min: number; max: number } {
  if (xMin > xMax || zMin > zMax || step <= 0) throw new RangeError('footprintGround: empty box or step <= 0');
  const ix = Math.max(1, Math.ceil((xMax - xMin) / step));
  const iz = Math.max(1, Math.ceil((zMax - zMin) / step));
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let min = Infinity;
  let max = -Infinity;
  for (let a = 0; a <= ix; a++) {
    const lx = xMin + ((xMax - xMin) * a) / ix;
    for (let b = 0; b <= iz; b++) {
      const lz = zMin + ((zMax - zMin) * b) / iz;
      const h = groundHeightAt(track, x + lx * cos + lz * sin, z - lx * sin + lz * cos);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
}

import type { DemGrid } from '../dem/fetchDem';
import { sampleDem } from './elevation';
import { unprojectXZ, type LonLat, type Point2 } from '../../src/track/geo';
import type { SurfaceStrip, Terrain } from '../../src/core/types';

const MARGIN = 400;
const SPACING = 8;
const BLEND = 30;
const DIP = 0.15;

// cells are corridor + BLEND wide, so an empty 3x3 neighbourhood means d > corridor + BLEND
interface CellGrid { cell: number; map: Map<string, number[]> }

function buildCellGrid(centerline: Point2[], cell: number): CellGrid {
  const map = new Map<string, number[]>();
  for (let i = 0; i < centerline.length; i++) {
    const key = `${Math.floor(centerline[i][0] / cell)},${Math.floor(centerline[i][1] / cell)}`;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  }
  return { cell, map };
}

// nearest centerline index, or -1 when none within one cell; ties keep the lowest index
function nearestIndex(g: CellGrid, x: number, z: number, centerline: Point2[]): number {
  const cx = Math.floor(x / g.cell);
  const cz = Math.floor(z / g.cell);
  let best = -1;
  let minD2 = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = g.map.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const i of list) {
        const ex = x - centerline[i][0];
        const ez = z - centerline[i][1];
        const d2 = ex * ex + ez * ez;
        if (d2 < minD2) {
          minD2 = d2;
          best = i;
        }
      }
    }
  }
  return best;
}

function rightNormalAt(cx: Point2[], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

export function buildTerrain(
  grid: DemGrid, centerline: Point2[], elevation: number[],
  origin: LonLat, widthMeters: number, maxBarrierOffset: number, bank?: number[],
): Terrain {
  if (centerline.length < 2) {
    throw new Error('buildTerrain: centerline needs >= 2 points');
  }
  if (elevation.length !== centerline.length) {
    throw new Error('buildTerrain: elevation.length must equal centerline.length');
  }
  if (!(widthMeters > 0)) {
    throw new Error('buildTerrain: widthMeters must be > 0');
  }
  if (maxBarrierOffset < 0) {
    throw new Error('buildTerrain: maxBarrierOffset must be >= 0');
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of centerline) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const originX = (minX + maxX) / 2;
  const originZ = (minZ + maxZ) / 2;
  const sizeX = maxX - minX + 2 * MARGIN;
  const sizeZ = maxZ - minZ + 2 * MARGIN;
  const cols = Math.round(sizeX / SPACING);
  const rows = Math.round(sizeZ / SPACING);

  const corridor = widthMeters / 2 + maxBarrierOffset + 5;
  const cells = buildCellGrid(centerline, corridor + BLEND);

  const [startLon, startLat] = unprojectXZ(centerline[0], origin);
  const startDem = sampleDem(grid, startLon, startLat);

  const heights = new Array<number>((rows + 1) * (cols + 1));
  const stepX = sizeX / cols;
  const stepZ = sizeZ / rows;
  for (let j = 0; j <= cols; j++) {
    const x = originX - sizeX / 2 + j * stepX;
    for (let i = 0; i <= rows; i++) {
      const z = originZ - sizeZ / 2 + i * stepZ;
      const [lon, lat] = unprojectXZ([x, z], origin);
      let h = sampleDem(grid, lon, lat) - startDem;
      const idx = nearestIndex(cells, x, z, centerline);
      if (idx >= 0) {
        const d = Math.hypot(x - centerline[idx][0], z - centerline[idx][1]);
        // The corridor follows the cross-slope so the banked sections blend back
        // to the natural height instead of stepping at the verge edge.
        const bankAngle = bank === undefined ? 0 : bank[idx] ?? 0;
        const [rx, rz] = rightNormalAt(centerline, idx);
        const lateral = (x - centerline[idx][0]) * rx + (z - centerline[idx][1]) * rz;
        const flat = elevation[idx] - DIP + lateral * (bankAngle === 0 ? 0 : Math.tan(bankAngle));
        if (d <= corridor) {
          h = flat;
        } else if (d < corridor + BLEND) {
          h = flat + (h - flat) * ((d - corridor) / BLEND);
        }
      }
      heights[j * (rows + 1) + i] = Math.round(h * 100) / 100;
    }
  }

  return { originX, originZ, sizeX, sizeZ, rows, cols, heights };
}

/** Mutates terrain.heights in place; called by buildTrack after buildTerrain with buildTrackSurfaces(track). */
export function clampTerrainBelowStrips(
  terrain: Terrain, strips: readonly SurfaceStrip[], dip = DIP,
): void {
  const { rows, cols, heights, originX, originZ, sizeX, sizeZ } = terrain;
  const x0 = originX - sizeX / 2;
  const z0 = originZ - sizeZ / 2;
  const stepX = sizeX / cols;
  const stepZ = sizeZ / rows;
  const stride = rows + 1;
  for (const strip of strips) {
    const pos = strip.positions;
    const ind = strip.indices;
    for (let t = 0; t + 2 < ind.length; t += 3) {
      const a = 3 * ind[t];
      const b = 3 * ind[t + 1];
      const c = 3 * ind[t + 2];
      // Round like buildTerrain so a bound of e.g. -1.549999976 still reads as -1.55
      const bound = Math.round((Math.min(pos[a + 1], pos[b + 1], pos[c + 1]) - dip) * 100) / 100;
      const minX = Math.min(pos[a], pos[b], pos[c]);
      const maxX = Math.max(pos[a], pos[b], pos[c]);
      const minZ = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]);
      const maxZ = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
      // Cells whose closed box overlaps the triangle box; 1e-9 keeps exact-border cases in.
      const jLo = Math.max(0, Math.ceil((minX - x0) / stepX - 1 - 1e-9));
      const jHi = Math.min(cols - 1, Math.floor((maxX - x0) / stepX + 1e-9));
      const iLo = Math.max(0, Math.ceil((minZ - z0) / stepZ - 1 - 1e-9));
      const iHi = Math.min(rows - 1, Math.floor((maxZ - z0) / stepZ + 1e-9));
      for (let j = jLo; j <= jHi; j++) {
        for (let i = iLo; i <= iHi; i++) {
          const k0 = j * stride + i;
          const k1 = k0 + stride;
          if (heights[k0] > bound) heights[k0] = bound;
          if (heights[k0 + 1] > bound) heights[k0 + 1] = bound;
          if (heights[k1] > bound) heights[k1] = bound;
          if (heights[k1 + 1] > bound) heights[k1 + 1] = bound;
        }
      }
    }
  }
}

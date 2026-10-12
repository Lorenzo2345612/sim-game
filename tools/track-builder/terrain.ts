import type { DemGrid } from '../dem/fetchDem';
import { sampleDem } from './elevation';
import { unprojectXZ, type LonLat, type Point2 } from '../../src/track/geo';
import type { Terrain } from '../../src/core/types';

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

export function buildTerrain(
  grid: DemGrid, centerline: Point2[], elevation: number[],
  origin: LonLat, widthMeters: number, maxBarrierOffset: number,
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
        const flat = elevation[idx] - DIP;
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

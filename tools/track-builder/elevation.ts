import type { DemGrid } from '../dem/fetchDem';
import { unprojectXZ, type LonLat, type Point2 } from '../../src/track/geo';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function sampleDem(grid: DemGrid, lon: number, lat: number): number {
  const col = clamp((lon - grid.lon0) / grid.dLon, 0, grid.cols - 1);
  const row = clamp((grid.lat0 - lat) / grid.dLat, 0, grid.rows - 1);
  const j0 = clamp(Math.floor(col), 0, grid.cols - 2);
  const i0 = clamp(Math.floor(row), 0, grid.rows - 2);
  const fx = col - j0;
  const fy = row - i0;
  const top = i0 * grid.cols + j0;
  const bottom = top + grid.cols;
  const h = grid.heights;
  return (h[top] * (1 - fx) + h[top + 1] * fx) * (1 - fy) +
    (h[bottom] * (1 - fx) + h[bottom + 1] * fx) * fy;
}

export function centerlineHeights(grid: DemGrid, centerline: Point2[], origin: LonLat): number[] {
  return centerline.map(([x, z]) => {
    const [lon, lat] = unprojectXZ([x, z], origin);
    return sampleDem(grid, lon, lat);
  });
}

export function elevationProfile(raw: number[], window = 25): number[] {
  const n = raw.length;
  const half = Math.floor(window / 2);
  const profile = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) {
      sum += raw[(i + k + n) % n];
    }
    profile[i] = sum / window;
  }
  const start = profile[0];
  for (let i = 0; i < n; i++) {
    profile[i] -= start;
  }
  return profile;
}

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

// Grey-scale morphological opening (erosion then dilation) with a clamped square window
export function removeCanopy(grid: DemGrid, radiusCells: number): DemGrid {
  if (!Number.isInteger(radiusCells) || radiusCells < 0) {
    throw new Error(`canopyRadiusCells must be a non-negative integer, got ${radiusCells}`);
  }
  const { rows, cols, heights } = grid;
  const out: DemGrid = { ...grid, heights: heights.slice() };
  if (radiusCells === 0) return out;
  const eroded = new Array<number>(rows * cols);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? heights : eroded;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let extreme = pass === 0 ? Infinity : -Infinity;
        for (let di = -radiusCells; di <= radiusCells; di++) {
          const ci = clamp(i + di, 0, rows - 1) * cols;
          for (let dj = -radiusCells; dj <= radiusCells; dj++) {
            const v = src[ci + clamp(j + dj, 0, cols - 1)];
            if (pass === 0 ? v < extreme : v > extreme) extreme = v;
          }
        }
        (pass === 0 ? eroded : out.heights)[i * cols + j] = extreme;
      }
    }
  }
  return out;
}

export function centerlineHeights(grid: DemGrid, centerline: Point2[], origin: LonLat): number[] {
  return centerline.map(([x, z]) => {
    const [lon, lat] = unprojectXZ([x, z], origin);
    return sampleDem(grid, lon, lat);
  });
}

export function smoothProfile(raw: number[], spacingM: number, sigmaM: number): number[] {
  if (!(spacingM > 0)) throw new Error(`spacingM must be > 0, got ${spacingM}`);
  if (!(sigmaM > 0)) throw new Error(`sigmaM must be > 0, got ${sigmaM}`);
  const n = raw.length;
  if (n === 0) return [];
  const radius = Math.ceil((3 * sigmaM) / spacingM);
  const kernel = new Array<number>(2 * radius + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-0.5 * ((k * spacingM) / sigmaM) ** 2);
    kernel[k + radius] = w;
    sum += w;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      acc += kernel[k + radius] * raw[(((i + k) % n) + n) % n];
    }
    out[i] = acc / sum;
  }
  return out;
}

export function limitGrade(profile: number[], spacingM: number, maxGrade: number): number[] {
  if (!(spacingM > 0)) throw new Error(`spacingM must be > 0, got ${spacingM}`);
  if (!(maxGrade >= 0)) throw new Error(`maxGrade must be >= 0, got ${maxGrade}`);
  const n = profile.length;
  const out = profile.slice();
  if (n <= 1) return out;
  const maxDh = maxGrade * spacingM;
  const clampTo = (i: number, ref: number) => {
    const v = Math.min(ref + maxDh, Math.max(ref - maxDh, out[i]));
    if (v !== out[i]) {
      out[i] = v;
      return true;
    }
    return false;
  };
  for (let iter = 0; iter < 100; iter++) {
    let changed = false;
    for (let i = 0; i < n - 1; i++) changed = clampTo(i + 1, out[i]) || changed;
    for (let i = n - 1; i >= 1; i--) changed = clampTo(i, out[(i + 1) % n]) || changed;
    if (!changed) break;
  }
  const closure = out[n - 1] - out[0];
  const target = Math.sign(closure) * Math.min(Math.abs(closure), maxDh);
  const residual = closure - target;
  if (residual !== 0) {
    for (let i = 1; i < n; i++) out[i] -= (residual * i) / (n - 1);
  }
  return out;
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

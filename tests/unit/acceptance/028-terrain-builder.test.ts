import { describe, it, expect } from 'vitest';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';
import type { Terrain } from '../../../src/core/types';

const ORIGIN: LonLat = [0, 0];
const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;

// DEM pixels (30 m) centred on world x = -615 + 30*j, z = -615 + 30*i; height linear in x/z
function makeDem(slopeX: number, slopeZ: number): DemGrid {
  const rows = 42;
  const cols = 42;
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    const z = -615 + 30 * i;
    for (let j = 0; j < cols; j++) {
      heights.push(100 + slopeX * (-615 + 30 * j) + slopeZ * z);
    }
  }
  return {
    lon0: -615 / DEG_M,
    lat0: 615 / DEG_M,
    dLon: 30 / DEG_M,
    dLat: 30 / DEG_M,
    rows,
    cols,
    heights,
  };
}

// closed polyline through the corners, given spacing per edge, last point not repeated
function walk(corners: Point2[], spacing: number): Point2[] {
  const pts: Point2[] = [];
  for (let e = 0; e < corners.length; e++) {
    const [ax, az] = corners[e];
    const [bx, bz] = corners[(e + 1) % corners.length];
    const n = Math.round(Math.hypot(bx - ax, bz - az) / spacing);
    for (let k = 0; k < n; k++) {
      pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
  }
  return pts;
}

// height of the node at world (x, z), column-major Rapier layout
function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

describe('028 terrain builder acceptance', () => {
  it('AT1: flat DEM + 400 m square gives spacing 8 ±0.5 m and bounds covering bbox + 400 m margin', () => {
    const centerline = walk([[-200, -200], [200, -200], [200, 200], [-200, 200]], 20);
    const elevation = centerline.map(() => 0);
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    expect(Math.abs(t.sizeX / t.cols - 8)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(t.sizeZ / t.rows - 8)).toBeLessThanOrEqual(0.5);
    const xs = centerline.map((p) => p[0]);
    const zs = centerline.map((p) => p[1]);
    const margin = 1e-6;
    expect(t.originX - t.sizeX / 2).toBeLessThanOrEqual(Math.min(...xs) - 400 + margin);
    expect(t.originX + t.sizeX / 2).toBeGreaterThanOrEqual(Math.max(...xs) + 400 - margin);
    expect(t.originZ - t.sizeZ / 2).toBeLessThanOrEqual(Math.min(...zs) - 400 + margin);
    expect(t.originZ + t.sizeZ / 2).toBeGreaterThanOrEqual(Math.max(...zs) + 400 - margin);
  });

  it('AT2: sloped DEM with zero track elevation reads -0.15 ±0.01 at a node 2 m from the centerline', () => {
    const centerline = Array.from({ length: 100 }, (_, k) => [-198 + 4 * k, 0] as Point2);
    const elevation = centerline.map(() => 0);
    const t = buildTerrain(makeDem(0.1, 0), centerline, elevation, ORIGIN, 12, 7);
    // node (0, 0) is 2 m from the centerline points (±2, 0), inside corridor c = 6 + 7 + 5 = 18
    expect(Math.abs(nodeHeight(t, 0, 0) - -0.15)).toBeLessThanOrEqual(0.01);
  });

  it('AT3: 30 m beyond the corridor edge the terrain returns to the DEM value relative to the start ±0.2', () => {
    const centerline = Array.from({ length: 100 }, (_, k) => [-198 + 4 * k, 0] as Point2);
    const elevation = centerline.map(() => 0);
    const t = buildTerrain(makeDem(0.1, 0), centerline, elevation, ORIGIN, 12, 7);
    // node (0, 48) is 48.04 m from (2, 0), i.e. 30 m beyond the corridor edge at 18 m;
    // DEM slope 0.1 m/m from centerline[0] at x = -198 → 19.8 m
    expect(Math.abs(nodeHeight(t, 0, 48) - 19.8)).toBeLessThanOrEqual(0.2);
  });

  it('AT4: heights has (rows+1)*(cols+1) entries, column-major, no NaN', () => {
    const centerline = walk([[-200, -100], [200, -100], [200, 100], [-200, 100]], 20);
    const elevation = centerline.map(() => 0);
    const t = buildTerrain(makeDem(0.1, 0.05), centerline, elevation, ORIGIN, 12, 3);
    expect(t.heights).toHaveLength((t.rows + 1) * (t.cols + 1));
    for (const h of t.heights) {
      expect(Number.isNaN(h)).toBe(false);
    }
    // corners and first-column neighbour probe col*(rows+1)+row; base = DEM(node) - DEM((-200, -100))
    expect(nodeHeight(t, -600, -500)).toBeCloseTo(-60, 6);
    expect(nodeHeight(t, 600, -500)).toBeCloseTo(60, 6);
    expect(nodeHeight(t, -600, 500)).toBeCloseTo(-10, 6);
    expect(nodeHeight(t, -600, -492)).toBeCloseTo(-59.6, 6);
  });
});

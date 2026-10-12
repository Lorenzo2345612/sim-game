import { describe, it, expect } from 'vitest';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';
import type { Terrain } from '../../../src/core/types';

const ORIGIN: LonLat = [0, 0];
const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;

// DEM pixels (30 m) centred on the world nodes x = -615 + 30j, z = -615 + 30i for the given
// origin; lon/lat grid uses cos(lat) so world positions are identical at any origin.
function makeDemAt(origin: LonLat, slopeX: number): DemGrid {
  const [lonO, latO] = origin;
  const cos = Math.cos((latO * Math.PI) / 180);
  const rows = 42;
  const cols = 42;
  const heights: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      heights.push(100 + slopeX * (-615 + 30 * j));
    }
  }
  return {
    lon0: lonO - 615 / (cos * DEG_M),
    lat0: latO + 615 / DEG_M,
    dLon: 30 / (cos * DEG_M),
    dLat: 30 / DEG_M,
    rows,
    cols,
    heights,
  };
}

function straight(): { centerline: Point2[]; elevation: number[] } {
  const centerline = Array.from({ length: 101 }, (_, k) => [-200 + 4 * k, 0] as Point2);
  return { centerline, elevation: centerline.map(() => 0) };
}

function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

describe('028 terrain builder post-implementation edge cases', () => {
  it('POST1: a non-zero origin is used for unprojecting every node, heights match the [0,0] origin build', () => {
    const { centerline, elevation } = straight();
    const spaOrigin: LonLat = [5.971, 50.437];
    const a = buildTerrain(makeDemAt(ORIGIN, 0.1), centerline, elevation, ORIGIN, 12, 3);
    const b = buildTerrain(makeDemAt(spaOrigin, 0.1), centerline, elevation, spaOrigin, 12, 3);
    // corridor, blend, base and far corner probe every branch
    for (const [x, z] of [[0, 8], [0, 24], [0, 48], [-600, -400]] as [number, number][]) {
      expect(Math.abs(nodeHeight(a, x, z) - nodeHeight(b, x, z))).toBeLessThanOrEqual(0.01);
    }
    expect(Math.abs(nodeHeight(b, 0, 8) - -0.15)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(nodeHeight(b, 0, 24) - 6.57)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nodeHeight(b, 0, 48) - 20)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nodeHeight(b, -600, -400) - -40)).toBeLessThanOrEqual(0.01);
  });

  it('POST2: cols/rows use Math.round of size/8 and node x advances by sizeX/cols, not 8 m', () => {
    const flat = makeDemAt(ORIGIN, 0);
    const elev: number[] = [0, 0];
    // sizeX = 1202 → 150.25 cells: round 150, ceil 151
    const a = buildTerrain(flat, [[-201, 0], [201, 0]], elev, ORIGIN, 12, 3);
    expect(a.sizeX).toBeCloseTo(1202, 6);
    expect(a.cols).toBe(150);
    // sizeX = 1206 → 150.75 cells: round 151, floor 150
    const b = buildTerrain(flat, [[-203, 0], [203, 0]], elev, ORIGIN, 12, 3);
    expect(b.cols).toBe(151);
    // sizeZ = 1198 → 149.75: round 150, floor 149
    const c = buildTerrain(flat, [[0, -199], [0, 199]], elev, ORIGIN, 12, 3);
    expect(c.rows).toBe(150);
    // node j = 75 sits at x = 0 (75 * 1202/150); a fixed 8 m step would put it at x = -1
    const sloped = makeDemAt(ORIGIN, 0.1);
    const t = buildTerrain(sloped, [[-201, 0], [201, 0]], elev, ORIGIN, 12, 3);
    expect(Math.abs(nodeHeight(t, 0, 400) - 20.1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nodeHeight(t, 601, 400) - 80.2)).toBeLessThanOrEqual(0.01);
  });

  it('POST3: with maxBarrierOffset 0 the corridor edge is exactly widthMeters/2 + 5', () => {
    const { centerline, elevation } = straight();
    const t = buildTerrain(makeDemAt(ORIGIN, 0), centerline, elevation, ORIGIN, 12, 0);
    // c = 11 (with the usual offset 3 it would be 14): z=8 corridor, z=16/40 blend, z=48 base
    expect(Math.abs(nodeHeight(t, 0, 8) - -0.15)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(nodeHeight(t, 0, 16) - -0.125)).toBeLessThanOrEqual(0.006);
    expect(Math.abs(nodeHeight(t, 0, 40) - -0.005)).toBeLessThanOrEqual(0.006);
    expect(Math.abs(nodeHeight(t, 0, 48) - 0)).toBeLessThanOrEqual(0.005);
  });

  it('POST4: Spa-scale terrain (7 km centerline, ~286k nodes) builds in under 20 s with no NaN', () => {
    const corners: Point2[] = [[-2000, -1500], [2000, -1500], [2000, 1500], [-2000, 1500]];
    const centerline: Point2[] = [];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = corners[e];
      const [bx, bz] = corners[(e + 1) % 4];
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 2);
      for (let k = 0; k < n; k++) {
        centerline.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
      }
    }
    const elevation = centerline.map(() => 0);
    const t0 = performance.now();
    const t = buildTerrain(makeDemAt(ORIGIN, 0), centerline, elevation, ORIGIN, 12, 3);
    const elapsed = performance.now() - t0;
    expect(centerline).toHaveLength(7000);
    expect(t.heights).toHaveLength((t.rows + 1) * (t.cols + 1));
    expect(t.heights.length).toBeGreaterThanOrEqual(286000);
    expect(elapsed).toBeLessThan(20000);
    expect(Math.abs(nodeHeight(t, -2000, -1500) - -0.15)).toBeLessThanOrEqual(0.005);
    for (const h of t.heights) expect(Number.isFinite(h)).toBe(true);
  }, 30000);

  it('POST5: a terrain larger than the DEM clamps and stays finite instead of producing NaN', () => {
    const dem: DemGrid = {
      lon0: -60 / DEG_M, lat0: 60 / DEG_M, dLon: 30 / DEG_M, dLat: 30 / DEG_M,
      rows: 5, cols: 5, heights: new Array(25).fill(100),
    };
    const centerline: Point2[] = [];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = [[-200, -200], [200, -200], [200, 200], [-200, 200]][e];
      const [bx, bz] = [[-200, -200], [200, -200], [200, 200], [-200, 200]][(e + 1) % 4];
      for (let k = 0; k < 20; k++) {
        centerline.push([ax + ((bx - ax) * k) / 20, az + ((bz - az) * k) / 20]);
      }
    }
    const t = buildTerrain(dem, centerline, centerline.map(() => 0), ORIGIN, 12, 3);
    expect(t.heights).toHaveLength((t.rows + 1) * (t.cols + 1));
    for (const h of t.heights) expect(Number.isFinite(h)).toBe(true);
    // nodes far outside the 120 m DEM: clamped flat 100, start also 100 → base 0
    expect(Math.abs(nodeHeight(t, 600, 400) - 0)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nodeHeight(t, -600, -400) - 0)).toBeLessThanOrEqual(0.01);
    // node on the centerline edge still gets the corridor dip
    expect(Math.abs(nodeHeight(t, 0, -200) - -0.15)).toBeLessThanOrEqual(0.005);
  });
});

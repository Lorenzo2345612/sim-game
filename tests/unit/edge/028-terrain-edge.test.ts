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

function straight(): { centerline: Point2[]; elevation: number[] } {
  const centerline = Array.from({ length: 101 }, (_, k) => [-200 + 4 * k, 0] as Point2);
  return { centerline, elevation: centerline.map(() => 0) };
}

// height of the node at world (x, z); fixtures keep every probed node exactly on the grid
function nodeHeight(t: Terrain, x: number, z: number): number {
  const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
  const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
  return t.heights[j * (t.rows + 1) + i];
}

describe('028 terrain builder edge cases', () => {
  it('EDGE1: every output height is a multiple of 0.01 m (round to 0.01 rule)', () => {
    const { centerline, elevation } = straight();
    const t = buildTerrain(makeDem(0.037, 0), centerline, elevation, ORIGIN, 12, 3);
    // slope 0.037 makes most base heights non-round; an unrounded build fails here
    for (const h of t.heights) {
      expect(Math.abs(h - Math.round(h * 100) / 100)).toBeLessThan(1e-9);
    }
  });

  it('EDGE2: inside the corridor the height is elevation[nearest] - 0.15, not a constant', () => {
    const { centerline } = straight();
    const elevation = centerline.map((_, k) => 2 * k);
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    // (0, 8): nearest point (-200+4*50, 0), d = 8 <= c = 14; base = 0 (flat DEM)
    expect(Math.abs(nodeHeight(t, 0, 8) - (100 - 0.15))).toBeLessThanOrEqual(0.01);
    // (104, -8): nearest point k = 76, elevation 152
    expect(Math.abs(nodeHeight(t, 104, -8) - (152 - 0.15))).toBeLessThanOrEqual(0.01);
  });

  it('EDGE3: between the corridor edge and c+30 the height blends linearly toward the base', () => {
    const { centerline, elevation } = straight();
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    // c = 14, blend to base 0 over 30 m; nodes at distance d give -0.15*(1-(d-14)/30)
    const expected: [number, number][] = [[16, -0.14], [24, -0.1], [32, -0.06], [40, -0.02]];
    let prev = -0.15;
    for (const [z, e] of expected) {
      const h = nodeHeight(t, 0, z);
      expect(Math.abs(h - e)).toBeLessThanOrEqual(0.01);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
  });

  it('EDGE4: the corridor edge is widthMeters/2 + maxBarrierOffset + 5', () => {
    const { centerline, elevation } = straight();
    const flat = makeDem(0, 0);
    const a = buildTerrain(flat, centerline, elevation, ORIGIN, 12, 3); // c = 14
    const b = buildTerrain(flat, centerline, elevation, ORIGIN, 24, 32); // c = 49
    const c = buildTerrain(flat, centerline, elevation, ORIGIN, 12, 32); // c = 43
    // node (0, 48): d = 48
    expect(Math.abs(nodeHeight(a, 0, 48) - 0)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(nodeHeight(b, 0, 48) - -0.15)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(nodeHeight(c, 0, 48) - -0.125)).toBeLessThanOrEqual(0.01);
  });

  it('EDGE5: origin is the exact centre of bbox + 400 m and rows/cols are round(size/8)', () => {
    const centerline = walk([[-100, -300], [300, -300], [300, 100], [-100, 100]], 20);
    const elevation = centerline.map(() => 0);
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    expect(t.originX).toBeCloseTo(100, 6);
    expect(t.originZ).toBeCloseTo(-100, 6);
    expect(t.sizeX).toBeCloseTo(1200, 6);
    expect(t.sizeZ).toBeCloseTo(1200, 6);
    expect(t.cols).toBe(150);
    expect(t.rows).toBe(150);
    expect(t.sizeX / t.cols).toBeCloseTo(8, 9);
    expect(t.sizeZ / t.rows).toBeCloseTo(8, 9);
  });

  it('EDGE6: beyond c + 30 the height is the base height even when the track is elevated', () => {
    const { centerline } = straight();
    const elevation = centerline.map((_, k) => 2 * k);
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    // node (0, 48) is past the blend; nearest elevation is 100, must not leak
    expect(Math.abs(nodeHeight(t, 0, 48) - 0)).toBeLessThanOrEqual(0.01);
  });

  it('EDGE7: the nearest centerline point is picked by distance, not array order', () => {
    const leg1 = Array.from({ length: 101 }, (_, k) => [-200 + 4 * k, 0] as Point2);
    const leg2 = Array.from({ length: 101 }, (_, j) => [200 - 4 * j, 8] as Point2);
    const centerline = [...leg1, ...leg2];
    const elevation = [...leg1.map((_, k) => k), ...leg2.map((_, j) => 200 + j)];
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    // z bounds [-400, 404], rows = round(808/8) = 101, spacing 8 → grid nodes at z ≡ 0 mod 8
    // node (0, 0): nearest is leg1 (0, 0) at d = 0, elevation 50; first-in-corridor point
    // leg1 (-12, 0) has elevation 47 → distinguishes true nearest from first match
    expect(Math.abs(nodeHeight(t, 0, 0) - (50 - 0.15))).toBeLessThanOrEqual(0.01);
    // node (0, 16): nearest is leg2 (0, 8) at d = 8, elevation 250, not leg1 (0, 0) at d = 16;
    // leg2's first in-corridor point is (8, 8), elevation 248
    expect(Math.abs(nodeHeight(t, 0, 16) - (250 - 0.15))).toBeLessThanOrEqual(0.01);
  });

  it('EDGE8: buildTerrain does not mutate centerline, elevation or DEM heights', () => {
    const { centerline, elevation } = straight();
    const grid = makeDem(0.1, 0);
    const centerline0 = centerline.map((p) => [...p] as Point2);
    const elevation0 = [...elevation];
    const heights0 = [...grid.heights];
    buildTerrain(grid, centerline, elevation, ORIGIN, 12, 3);
    expect(centerline).toEqual(centerline0);
    expect(elevation).toEqual(elevation0);
    expect(grid.heights).toEqual(heights0);
  });

  it('EDGE9: each documented invalid input throws Error', () => {
    const flat = makeDem(0, 0);
    const valid: Point2[] = [[-2, 0], [2, 0]];
    expect(() => buildTerrain(flat, valid, [0, 0], ORIGIN, 12, 3)).not.toThrow();
    expect(() => buildTerrain(flat, [[0, 0]] as Point2[], [0], ORIGIN, 12, 3)).toThrow();
    expect(() => buildTerrain(flat, valid, [0], ORIGIN, 12, 3)).toThrow();
    expect(() => buildTerrain(flat, valid, [0, 0, 0], ORIGIN, 12, 3)).toThrow();
    expect(() => buildTerrain(flat, valid, [0, 0], ORIGIN, 0, 3)).toThrow();
    expect(() => buildTerrain(flat, valid, [0, 0], ORIGIN, -1, 3)).toThrow();
    expect(() => buildTerrain(flat, valid, [0, 0], ORIGIN, 12, -0.5)).toThrow();
  });

  it('EDGE10: equidistant centerline points — the lowest array index sets the corridor height', () => {
    const leg1 = Array.from({ length: 101 }, (_, k) => [-200 + 4 * k, 0] as Point2);
    const leg2 = Array.from({ length: 101 }, (_, j) => [200 - 4 * j, 16] as Point2);
    const centerline = [...leg1, ...leg2];
    const elevation = [...leg1.map((_, k) => k), ...leg2.map((_, j) => 200 + j)];
    const t = buildTerrain(makeDem(0, 0), centerline, elevation, ORIGIN, 12, 3);
    // z bounds [-400, 416], rows = round(816/8) = 102, spacing 8 → node (0, 8) is on the grid
    // (0, 8) is exactly d = 8 from leg1 (0, 0) (global index 50, elevation 50)
    // and from leg2 (0, 16) (global index 151, elevation 250); c = 6 + 3 + 5 = 14 → corridor
    expect(Math.abs(nodeHeight(t, 0, 8) - (50 - 0.15))).toBeLessThanOrEqual(0.005);
  });
});

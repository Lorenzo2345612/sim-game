import { describe, it, expect } from 'vitest';
import type { SurfaceStrip, Terrain } from '../../../src/core/types';
import { clampTerrainBelowStrips } from '../../../tools/track-builder/terrain';

// Rapier layout: heights[j * (rows + 1) + i], j = x index across sizeX, i = z index across sizeZ, origin = centre.
function tri(xs: number[], ys: number[], zs: number[]): SurfaceStrip {
  return {
    surface: 'gravel',
    positions: new Float32Array([xs[0], ys[0], zs[0], xs[1], ys[1], zs[1], xs[2], ys[2], zs[2]]),
    indices: new Uint32Array([0, 1, 2]),
    uvs: new Float32Array(0),
  };
}

function flatTerrain(rows: number, cols: number, originX = 0, originZ = 0, size = 4): Terrain {
  const n = (rows + 1) * (cols + 1);
  return { originX, originZ, sizeX: cols * size, sizeZ: rows * size, rows, cols, heights: new Array(n).fill(0) };
}

describe('097 terrain below strips edge cases', () => {
  it('EDGE1: a vertex already below the clamp bound is left exactly unchanged (clamping never raises terrain)', () => {
    // 8x8 m terrain, 2x2 cells of 4 m; triangle bbox strictly inside cell (j=0,i=0), y = -1, default dip -> bound -1.15.
    const t = flatTerrain(2, 2);
    t.heights[0] = -3; // far below bound
    t.heights[1] = -1.16; // just below bound
    t.heights[4] = -1.0; // above bound -> must decrease
    clampTerrainBelowStrips(t, [tri([-3.5, -0.5, -2], [-1, -1, -1], [-3.5, -3.5, -0.5])]);
    expect(t.heights[0]).toBe(-3);
    expect(t.heights[1]).toBe(-1.16);
    expect(t.heights[4]).toBeLessThanOrEqual(-1.15);
    expect(t.heights[3]).toBeLessThanOrEqual(-1.15);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE2: an explicit dip argument replaces the default (dip 0.5 clamps to minY - 0.5)', () => {
    const t = flatTerrain(2, 2);
    t.heights[4] = -1.2; // passes the default-dip bound -1.15 but must fail dip 0.5 bound -1.5
    t.heights[0] = -1.6; // below dip-0.5 bound -> untouched
    clampTerrainBelowStrips(t, [tri([-3.5, -0.5, -2], [-1, -1, -1], [-3.5, -3.5, -0.5])], 0.5);
    expect(t.heights[4]).toBeLessThanOrEqual(-1.5);
    expect(t.heights[1]).toBeLessThanOrEqual(-1.5);
    expect(t.heights[3]).toBeLessThanOrEqual(-1.5);
    expect(t.heights[0]).toBe(-1.6);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE3: dip = 0 clamps to exactly the triangle minY (an explicit 0 is honoured, not defaulted)', () => {
    const t = flatTerrain(2, 2);
    clampTerrainBelowStrips(t, [tri([-3.5, -0.5, -2], [-1, -1, -1], [-3.5, -3.5, -0.5])], 0);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBeCloseTo(-1.0, 4);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE4: the bound uses the lowest of the triangle vertex y values, not the highest or average', () => {
    // ys -1.0 / -0.6 / -1.4 -> minY -1.4, bound -1.55; max-based (-0.75) or avg-based (-0.95) fail this.
    const t = flatTerrain(2, 2);
    clampTerrainBelowStrips(t, [tri([-3.5, -0.5, -2], [-1.0, -0.6, -1.4], [-3.5, -3.5, -0.5])]);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBeLessThanOrEqual(-1.55);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE5: a triangle whose bounding box spans two cells clamps the corner union of both cells', () => {
    // 12x12 m terrain, 3x3 cells of 4 m; bbox x in [-3.9,-0.1] crosses the x=-2 cell border, z inside i=0.
    const t = flatTerrain(3, 3, 0, 0, 4);
    clampTerrainBelowStrips(t, [tri([-3.9, -0.1, -2], [-2, -2, -2], [-5.5, -5.5, -2.5])]);
    for (const k of [0, 1, 4, 5, 8, 9]) expect(t.heights[k], `corner ${k}`).toBeLessThanOrEqual(-2.15);
    for (const k of [2, 3, 6, 7, 10, 11, 12, 13, 14, 15]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE6: overlapping triangle bounds combine to the lowest and the result is independent of strip order', () => {
    const a = tri([-3.5, -2.5, -3], [-1, -1, -1], [-3.5, -3.5, -2.5]); // bound -1.15
    const b = tri([-1.5, -0.5, -1], [-3, -3, -3], [-1.5, -1.5, -0.5]); // bound -3.15
    const t1 = flatTerrain(2, 2);
    const t2 = flatTerrain(2, 2);
    clampTerrainBelowStrips(t1, [a, b]);
    clampTerrainBelowStrips(t2, [b, a]);
    for (const k of [0, 1, 3, 4]) expect(t1.heights[k], `corner ${k}`).toBeLessThanOrEqual(-3.15);
    for (const k of [2, 5, 6, 7, 8]) {
      expect(t1.heights[k], `vertex ${k}`).toBe(0);
      expect(t2.heights[k], `t2 vertex ${k}`).toBe(0);
    }
    expect(t2.heights).toEqual(t1.heights);
  });

  it('EDGE7: no strips and a strip without triangles leave every height exactly unchanged', () => {
    const base = [0.5, -1.25, 3, 0, 2.75, -0.5, 1, -2, 0.25];
    const t1 = { ...flatTerrain(2, 2), heights: [...base] };
    clampTerrainBelowStrips(t1, []);
    expect(t1.heights).toEqual(base);
    const empty: SurfaceStrip = { surface: 'grass', positions: new Float32Array([0, -5, 0, 1, -5, 1, 2, -5, 0]), indices: new Uint32Array(0), uvs: new Float32Array(0) };
    const t2 = { ...flatTerrain(2, 2), heights: [...base] };
    clampTerrainBelowStrips(t2, [empty]);
    expect(t2.heights).toEqual(base);
  });

  it('EDGE8: a terrain whose origin is not (0,0) maps triangle world coordinates to the correct cells', () => {
    // origin (130,-70), 8x8 m, cells of 4 m; bbox inside cell x in [126,130], z in [-70,-66] = (j=0,i=1).
    const t = flatTerrain(2, 2, 130, -70);
    clampTerrainBelowStrips(t, [tri([126.2, 129.8, 128], [-1, -1, -1], [-69.8, -69.8, -66.2])]);
    for (const k of [1, 2, 4, 5]) expect(t.heights[k], `corner ${k}`).toBeLessThanOrEqual(-1.15);
    for (const k of [0, 3, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE9: triangle bounding boxes fully outside the heightfield change nothing', () => {
    const t = flatTerrain(2, 2);
    clampTerrainBelowStrips(t, [
      tri([300, 302, 301], [-1, -1, -1], [50, 50, 52]),
      tri([-500, -498, -499], [3, 3, 3], [-40, -40, -38]),
    ]);
    for (let k = 0; k < t.heights.length; k++) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('EDGE10: clamping is idempotent - a second call changes no height', () => {
    const t = flatTerrain(2, 2);
    const strip = tri([-3.5, -0.5, -2], [-1, -1, -1], [-3.5, -3.5, -0.5]);
    clampTerrainBelowStrips(t, [strip]);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBeLessThanOrEqual(-1.15);
    const after = [...t.heights];
    clampTerrainBelowStrips(t, [strip]);
    expect(t.heights).toEqual(after);
  });
});

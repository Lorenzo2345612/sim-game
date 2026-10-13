import { describe, it, expect } from 'vitest';
import type { SurfaceStrip, Terrain } from '../../../src/core/types';
import { clampTerrainBelowStrips } from '../../../tools/track-builder/terrain';

// Rapier layout: heights[j * (rows + 1) + i], j = x index across sizeX, i = z index across sizeZ.
function flat(rows: number, cols: number, size = 4, originX = 0, originZ = 0): Terrain {
  return {
    originX,
    originZ,
    sizeX: cols * size,
    sizeZ: rows * size,
    rows,
    cols,
    heights: new Array<number>((rows + 1) * (cols + 1)).fill(0),
  };
}

function strip(positions: number[], indices: number[]): SurfaceStrip {
  return {
    surface: 'gravel',
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(0),
  };
}

describe('clampTerrainBelowStrips', () => {
  it('mutates heights in place and writes exactly minY - 0.15 (default dip)', () => {
    const t = flat(2, 2);
    const ref = t.heights;
    // Triangle strictly inside cell (0,0), x,z in [-4, 0].
    const ret = clampTerrainBelowStrips(t, [strip([-3, -1, -3, -1.5, -1, -3, -2.25, -1, -1.5], [0, 1, 2])]);
    expect(ret).toBeUndefined();
    expect(t.heights).toBe(ref);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('uses the indexed vertices only; unused vertices with wild y do not affect the bound', () => {
    const t = flat(2, 2);
    // v0, v2, v4 unused, y = -50 would drag the bound to -50.15 if read by position order.
    const s = strip(
      [0, -50, 0, -3, -1, -3, 0, -50, 0, -1.5, -1, -3, 0, -50, 0, -2.25, -1, -1.5],
      [1, 3, 5],
    );
    clampTerrainBelowStrips(t, [s]);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('indexes a non-square heightfield (rows != cols) by the overlapping cell only', () => {
    // 16x8 m, cells of 4 m: j in 0..3, i in 0..1, stride 3. Triangle inside cell (j=2, i=1).
    const t = flat(2, 4);
    clampTerrainBelowStrips(t, [strip([0.5, -1, 0.5, 3.5, -1, 0.5, 2, -1, 3.5], [0, 1, 2])]);
    for (const k of [7, 8, 10, 11]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [0, 1, 2, 3, 4, 5, 6, 9, 12, 13, 14]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('rounds a float32 vertex y to the centimetre before applying the dip', () => {
    const t = flat(2, 2);
    // -1.4 as float32 is -1.399999976158142; the bound must still be exactly -1.55.
    clampTerrainBelowStrips(t, [strip([-3.5, -1.4, -3.5, -0.5, -1.4, -3.5, -2, -1.4, -0.5], [0, 1, 2])]);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBe(-1.55);
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { clampTerrainBelowStrips } from '../../../tools/track-builder/terrain';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');

function tri(xs: number[], ys: number[], zs: number[], indices?: number[]): SurfaceStrip {
  return {
    surface: 'gravel',
    positions: new Float32Array(xs.map((x, v) => [x, ys[v], zs[v]]).flat()),
    indices: new Uint32Array(indices ?? [0, 1, 2]),
    uvs: new Float32Array(0),
  };
}

function flat(rows: number, cols: number, cell = 4): Terrain {
  return {
    originX: 0, originZ: 0, sizeX: cols * cell, sizeZ: rows * cell,
    rows, cols, heights: new Array<number>((rows + 1) * (cols + 1)).fill(0),
  };
}

describe('097 clampTerrainBelowStrips post-coder gaps', () => {
  it('POST1: a triangle whose bounding box exactly touches a cell border clamps both cells (closed-box overlap)', () => {
    // bbox x [-3, 0], z [-3, -1]; maxX = 0 is the border between cell j=0 (x in [-4,0]) and j=1.
    const t = flat(2, 2);
    clampTerrainBelowStrips(t, [tri([-3, -1, 0], [-1, -1, -1], [-3, -3, -1])]);
    for (const k of [0, 1, 3, 4, 6, 7]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [2, 5, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('POST2: a triangle sticking out of the grid clamps only the in-grid cells and writes no index out of range', () => {
    // bbox x [3.5, 8] crosses the +X grid edge (x1 = 4); only cell column j=1 is in range.
    const t = flat(2, 2);
    clampTerrainBelowStrips(t, [tri([3.5, 8, 6], [-1, -1, -1], [-3.5, -3.5, -1])]);
    for (const k of [3, 4, 6, 7]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [0, 1, 2, 5, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
    expect(t.heights.length).toBe(9);
  });

  it('POST3: the centimetre rounding of the bound can be up to 0.005 above minY - dip but never breaks the 0.10 AT2 margin', () => {
    // Float32(-1.645) = -1.6449999809265137; minY - dip = -1.79499998 rounds UP to -1.79.
    const minY = Float32Array.from([-1.645])[0];
    const t = flat(2, 2);
    clampTerrainBelowStrips(t, [tri([-3.5, -0.5, -2], [minY, minY, minY], [-3.5, -3.5, -0.5])]);
    for (const k of [0, 1, 3, 4]) {
      expect(t.heights[k], `corner ${k}`).toBe(-1.79);
      expect(t.heights[k], `corner ${k} vs AT2 margin`).toBeLessThanOrEqual(minY - 0.1);
    }
    for (const k of [2, 5, 6, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('POST4: a trailing partial triangle (indices length not a multiple of 3) is ignored, whole triangles before it apply', () => {
    const t = flat(2, 2);
    // v0..v2: real triangle in cell (j=0,i=0); v3 y=-50 at (2,2) would clamp cell (1,1) to -50.15 if processed.
    const strip: SurfaceStrip = {
      surface: 'gravel',
      positions: new Float32Array([-3.5, -1, -3.5, -0.5, -1, -3.5, -2, -1, -0.5, 2, -50, 2]),
      indices: new Uint32Array([0, 1, 2, 3]),
      uvs: new Float32Array(0),
    };
    clampTerrainBelowStrips(t, [strip]);
    for (const k of [0, 1, 3, 4]) expect(t.heights[k], `corner ${k}`).toBe(-1.15);
    for (const k of [5, 7, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('POST5: two triangles in one strip clamp their own cells with their own bounds; the shared corner takes the lower', () => {
    // A: cell (j=0,i=0) minY -1 -> bound -1.15; B: cell (j=1,i=0) minY -2 -> bound -2.15.
    const t = flat(2, 2);
    const strip: SurfaceStrip = {
      surface: 'gravel',
      positions: new Float32Array([
        -3.5, -1, -3.5, -0.5, -1, -3.5, -2, -1, -0.5,
        0.5, -2, -3.5, 3.5, -2, -3.5, 2, -2, -0.5,
      ]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      uvs: new Float32Array(0),
    };
    clampTerrainBelowStrips(t, [strip]);
    expect(t.heights[0]).toBe(-1.15);
    expect(t.heights[1]).toBe(-1.15);
    expect(t.heights[3]).toBe(-2.15); // shared with B
    expect(t.heights[4]).toBe(-2.15); // shared with B
    expect(t.heights[6]).toBe(-2.15);
    expect(t.heights[7]).toBe(-2.15);
    for (const k of [2, 5, 8]) expect(t.heights[k], `vertex ${k}`).toBe(0);
  });

  it('POST6: a single-cell heightfield (rows = cols = 1) clamps its four corners and stays in bounds', () => {
    const t = flat(1, 1, 8);
    clampTerrainBelowStrips(t, [tri([-3, 3, 0], [-1, -1, -1], [-3, -3, 0])]);
    expect(t.heights).toEqual([-1.15, -1.15, -1.15, -1.15]);
  });

  it('POST7: the regenerated tracks are fixed points of the clamp within 0.1 m, the escape-road interpolation of task 332 lowering a few cells by up to 0.09 m (buildTrack integration with buildTrackSurfaces)', () => {
    for (const id of ['monza', 'spa', 'silverstone']) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      const before = [...track.terrain.heights];
      clampTerrainBelowStrips(track.terrain, buildTrackSurfaces(track));
      track.terrain.heights.forEach((h, i) => {
        expect(Math.abs(h - before[i]), `${id}: height ${i} changed on re-clamp`).toBeLessThanOrEqual(0.1);
      });
    }
  }, 120000);
});

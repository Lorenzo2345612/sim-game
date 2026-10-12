import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain } from '../../../src/core/types';
import { createTerrainMesh } from '../../../src/render/terrainRenderer';

const ROWS = 4;
const COLS = 4;

// Flat 4x4 terrain (AT2 requires flat) with non-zero origin to pin the Rapier layout.
const terrain: Terrain = {
  originX: 10,
  originZ: -5,
  sizeX: 32,
  sizeZ: 40,
  rows: ROWS,
  cols: COLS,
  heights: new Array((ROWS + 1) * (COLS + 1)).fill(0),
};

function expectVertex(position: THREE.BufferAttribute, i: number, j: number): void {
  const k = i * (COLS + 1) + j;
  const ex = terrain.originX - terrain.sizeX / 2 + (j * terrain.sizeX) / COLS;
  const ez = terrain.originZ - terrain.sizeZ / 2 + (i * terrain.sizeZ) / ROWS;
  expect(Math.abs(position.getX(k) - ex)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(position.getZ(k) - ez)).toBeLessThanOrEqual(1e-6);
  const y = position.getY(k);
  const expected = terrain.heights[j * (ROWS + 1) + i];
  expect(Math.abs(y - expected)).toBeLessThanOrEqual(1e-6);
}

describe('036 terrain render acceptance', () => {
  it('AT1: vertex count 25 and each vertex matches the Rapier heightfield layout', () => {
    const mesh = createTerrainMesh(terrain);
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(position.count).toBe((ROWS + 1) * (COLS + 1));
    for (let i = 0; i <= ROWS; i++) {
      for (let j = 0; j <= COLS; j++) {
        expectVertex(position, i, j);
      }
    }
  });

  it('AT2: normals are computed and all point up (y > 0) for a flat terrain', () => {
    const mesh = createTerrainMesh(terrain);
    const normal = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    expect(normal).toBeDefined();
    expect(normal.count).toBe((ROWS + 1) * (COLS + 1));
    for (let k = 0; k < normal.count; k++) {
      expect(normal.getY(k)).toBeGreaterThan(0);
    }
  });

  it('AT3: uv repeats every 10 m (uv = world x/10, z/10)', () => {
    const mesh = createTerrainMesh(terrain);
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv).toBeDefined();
    expect(uv.count).toBe((ROWS + 1) * (COLS + 1));
    for (let k = 0; k < uv.count; k++) {
      expect(uv.getX(k)).toBeCloseTo(position.getX(k) / 10, 6);
      expect(uv.getY(k)).toBeCloseTo(position.getZ(k) / 10, 6);
    }
  });
});

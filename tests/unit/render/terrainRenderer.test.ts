import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain } from '../../../src/core/types';
import { createTerrainMesh } from '../../../src/render/terrainRenderer';

const ROWS = 3;
const COLS = 5;
const terrain: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 30,
  sizeZ: 20,
  rows: ROWS,
  cols: COLS,
  heights: new Array((ROWS + 1) * (COLS + 1)).fill(2),
};

const meshes: THREE.Mesh[] = [];
function build(t: Terrain = terrain, material?: THREE.Material): THREE.Mesh {
  const mesh = createTerrainMesh(t, material);
  meshes.push(mesh);
  return mesh;
}

afterEach(() => {
  while (meshes.length) meshes.pop()?.geometry.dispose();
});

describe('terrainRenderer edge cases', () => {
  it('throws on wrong heights.length', () => {
    expect(() => build({ ...terrain, heights: [0, 0, 0] })).toThrow(
      'createTerrainMesh: invalid terrain',
    );
  });

  it('index count is rows * cols * 6', () => {
    const mesh = build();
    expect(mesh.geometry.getIndex()?.count).toBe(ROWS * COLS * 6);
  });

  it('every face normal points up (y > 0) on flat terrain', () => {
    const mesh = build();
    const index = mesh.geometry.getIndex()!;
    const position = mesh.geometry.getAttribute('position');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (let t = 0; t < index.count; t += 3) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      normal.crossVectors(ab, ac);
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it('uses the given material and does not dispose it', () => {
    const material = new THREE.MeshStandardMaterial();
    let disposed = false;
    material.addEventListener('dispose', () => {
      disposed = true;
    });
    const mesh = build(terrain, material);
    expect(mesh.material).toBe(material);
    mesh.geometry.dispose();
    expect(disposed).toBe(false);
    material.dispose();
    expect(disposed).toBe(true);
  });

  it('mesh name and shadow flags', () => {
    const mesh = build();
    expect(mesh.name).toBe('terrain');
    expect(mesh.receiveShadow).toBe(true);
    expect(mesh.castShadow).toBe(false);
  });

  it('handles 1x1 terrain', () => {
    const mesh = build({
      originX: 5,
      originZ: -3,
      sizeX: 10,
      sizeZ: 10,
      rows: 1,
      cols: 1,
      heights: [0, 1, 2, 3],
    });
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBe(4);
    expect(position.getY(0)).toBe(0);
    expect(position.getY(1)).toBe(2);
    expect(position.getY(2)).toBe(1);
    expect(position.getY(3)).toBe(3);
    expect(mesh.geometry.getIndex()?.count).toBe(6);
  });
});

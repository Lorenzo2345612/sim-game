import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, type TreeFactory } from '../../../src/render/treeField';

const onePartFactory: TreeFactory = (preset, seed, leafFactor) => {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(leafFactor, 2, 1).translate(0, 1, 0);
  group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  group.name = `${preset}-${seed}`;
  return group;
};

const species: TreeSpecies[] = [{ name: 'oak', preset: 'Oak Medium', heightMeters: 10 }];
const flat = (): ((x: number, z: number) => number) => () => 0;

function expectMatricesClose(a: THREE.Matrix4, b: THREE.Matrix4): void {
  for (let i = 0; i < 16; i++) expect(a.elements[i]).toBeCloseTo(b.elements[i], 4);
}

describe('039 treeField edge cases', () => {
  it('empty species keeps 3 variants, zero instances and survives update/dispose', () => {
    const trees: TreeInstances[] = [{ species: 'oak', data: [] }];
    const field = createTreeField(trees, species, { factory: onePartFactory, terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(0);
    expect(field.variantCount('oak')).toBe(3);
    expect(field.instanceCount('pine')).toBe(0);
    expect(field.variantCount('pine')).toBe(0);
    expect(field.getInstanceLod('oak', 0)).toBe(-1);
    const out = new THREE.Matrix4().identity();
    expect(field.getInstanceMatrix('oak', 0, out)).toBe(out);
    expect(out.elements[12]).toBe(0);
    expect(() => field.update({ x: 0, y: 0, z: 0 })).not.toThrow();
    expect(field.object.children).toHaveLength(3 * 2);
    expect(() => field.dispose()).not.toThrow();
  });

  it('instance order is stable: index i maps to data[i] and variant i % 3', () => {
    const data = [0, 0, 1, 0, 10, 0, 2, 0.5, 20, 0, 0.5, 1, 30, 0, 1.5, 2, 40, 0, 1, 3, 50, 0, 2, 4, 60, 0, 1, 5];
    const trees: TreeInstances[] = [{ species: 'oak', data }];
    const first = createTreeField(trees, species, { factory: onePartFactory, terrainY: flat() });
    const second = createTreeField(trees, species, { factory: onePartFactory, terrainY: flat() });
    expect(first.instanceCount('oak')).toBe(7);

    const a = new THREE.Matrix4();
    const b = new THREE.Matrix4();
    for (let i = 0; i < 7; i++) {
      first.getInstanceMatrix('oak', i, a);
      second.getInstanceMatrix('oak', i, b);
      expectMatricesClose(a, b);
      expect(a.elements[12]).toBeCloseTo(data[i * 4], 4);
      expect(a.elements[13]).toBeCloseTo(0, 4);
      expect(a.elements[14]).toBeCloseTo(data[i * 4 + 1], 4);
    }

    // 3 variants x 2 LODs, one part each; child order is variant-major then LOD.
    const meshes = first.object.children as unknown as InstancedMesh2[];
    const perVariant = [3, 2, 2];
    for (let v = 0; v < 3; v++) {
      const level0 = meshes[v * 2];
      expect(level0.instancesCount).toBe(perVariant[v]);
      for (let local = 0; local < perVariant[v]; local++) {
        level0.getMatrixAt(local, a);
        first.getInstanceMatrix('oak', local * 3 + v, b);
        expectMatricesClose(a, b);
      }
    }

    first.dispose();
    second.dispose();
  });
});

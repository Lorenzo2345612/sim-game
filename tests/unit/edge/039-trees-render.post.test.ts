import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, scaleForHeight, type TreeFactory } from '../../../src/render/treeField';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const onePart: TreeFactory = (preset, seed, leafFactor) => {
  const group = new THREE.Group();
  group.name = `${preset}-${seed}-${leafFactor}`;
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2, 0.2).translate(0, 1, 0), new THREE.MeshStandardMaterial()));
  return group;
};

const OAK: TreeSpecies = { name: 'oak', preset: 'oak-preset', heightMeters: 10 };
const PINE: TreeSpecies = { name: 'pine', preset: 'pine-preset', heightMeters: 6 };
const flat = (): ((x: number, z: number) => number) => () => 0;

describe('039 trees render post', () => {
  it('multiple batches of one species are concatenated in data order', () => {
    const trees: TreeInstances[] = [
      { species: 'oak', data: [1, 2, 1, 0, 3, 4, 1, 0] },
      { species: 'pine', data: [9, 9, 1, 0] },
      { species: 'oak', data: [5, 6, 1, 0, 7, 8, 1, 0, 9, 10, 1, 0] },
    ];
    const field = createTreeField(trees, [OAK, PINE], { factory: onePart, terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(5);
    expect(field.instanceCount('pine')).toBe(1);
    const out = new THREE.Matrix4();
    const expected = [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
    ];
    for (let i = 0; i < expected.length; i++) {
      field.getInstanceMatrix('oak', i, out);
      expect(out.elements[12]).toBeCloseTo(expected[i][0], 6);
      expect(out.elements[14]).toBeCloseTo(expected[i][1], 6);
    }
    field.getInstanceMatrix('pine', 0, out);
    expect(out.elements[12]).toBeCloseTo(9, 6);
    field.dispose();
  });

  it('batches whose species is not in the species list are ignored', () => {
    const presets: string[] = [];
    const factory: TreeFactory = (preset, seed, leafFactor) => {
      presets.push(preset);
      return onePart(preset, seed, leafFactor);
    };
    const trees: TreeInstances[] = [
      { species: 'oak', data: [0, 0, 1, 0] },
      { species: 'ghost', data: [1, 1, 1, 0, 2, 2, 1, 0] },
    ];
    const field = createTreeField(trees, [OAK], { factory, terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(1);
    expect(field.instanceCount('ghost')).toBe(0);
    expect(field.variantCount('ghost')).toBe(0);
    expect([...new Set(presets)]).toEqual(['oak-preset']);
    expect(field.object.children).toHaveLength(6);
    field.dispose();
  });

  it('a trailing incomplete record in data is ignored', () => {
    const trees: TreeInstances[] = [{ species: 'oak', data: [0, 0, 1, 0, 10, 10, 1, 0, 20] }];
    const field = createTreeField(trees, [OAK], { factory: onePart, terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(2);
    const out = new THREE.Matrix4();
    field.getInstanceMatrix('oak', 1, out);
    expect(out.elements[12]).toBeCloseTo(10, 6);
    field.dispose();
  });

  it('every LOD level of a variant carries the same instance matrices and counts', () => {
    const data: number[] = [];
    for (let i = 0; i < 7; i++) data.push(i * 5, 0, 1 + i * 0.1, i * 0.4);
    const field = createTreeField([{ species: 'oak', data }], [OAK], { factory: onePart, terrainY: flat() });
    const meshes = field.object.children as unknown as InstancedMesh2[];
    const a = new THREE.Matrix4();
    const b = new THREE.Matrix4();
    const perVariant = [3, 2, 2];
    for (let v = 0; v < 3; v++) {
      const lod0 = meshes[v * 2];
      const lod1 = meshes[v * 2 + 1];
      expect(lod1.instancesCount).toBe(perVariant[v]);
      for (let local = 0; local < perVariant[v]; local++) {
        lod0.getMatrixAt(local, a);
        lod1.getMatrixAt(local, b);
        for (let e = 0; e < 16; e++) expect(b.elements[e]).toBeCloseTo(a.elements[e], 6);
      }
    }
    field.dispose();
  });

  it('instances start hidden and update shows exactly one LOD mesh per instance', () => {
    const trees: TreeInstances[] = [{ species: 'oak', data: [100, 0, 1, 0, 400, 0, 1, 0, 2000, 0, 1, 0] }];
    const field = createTreeField(trees, [OAK], { factory: onePart, terrainY: flat() });
    const meshes = field.object.children as unknown as InstancedMesh2[];
    for (const mesh of meshes) {
      for (let local = 0; local < mesh.instancesCount; local++) expect(mesh.getVisibilityAt(local)).toBe(false);
    }
    expect(field.getInstanceLod('oak', 0)).toBe(-1);
    field.update({ x: 0, y: 0, z: 0 });
    expect(meshes[0].getVisibilityAt(0)).toBe(true); // instance 0, variant 0, LOD0
    expect(meshes[1].getVisibilityAt(0)).toBe(false);
    expect(meshes[2].getVisibilityAt(0)).toBe(false); // instance 1, variant 1, LOD1
    expect(meshes[3].getVisibilityAt(0)).toBe(true);
    expect(meshes[4].getVisibilityAt(0)).toBe(false); // instance 2, variant 2, hidden
    expect(meshes[5].getVisibilityAt(0)).toBe(false);
    field.dispose();
  });

  it('frustum culling is enabled on every instanced mesh', () => {
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0] }], [OAK], { factory: onePart, terrainY: flat() });
    expect(field.object.children.length).toBeGreaterThan(0);
    for (const child of field.object.children) expect((child as THREE.Mesh).frustumCulled).toBe(true);
    field.dispose();
  });

  it('dispose() disposes every instanced mesh and is safe to call twice', () => {
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0, 5, 5, 1, 0] }], [OAK], { factory: onePart, terrainY: flat() });
    const meshes = [...field.object.children] as unknown as InstancedMesh2[];
    const spies = meshes.map((mesh) => vi.spyOn(mesh, 'dispose'));
    field.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(() => field.dispose()).not.toThrow();
  });

  it('a variant with zero bounding-box height falls back to 1 m so instance scale stays finite', () => {
    const flatFactory: TreeFactory = () => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0, 1), new THREE.MeshStandardMaterial()));
      return group;
    };
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0] }], [OAK], { factory: flatFactory, terrainY: flat() });
    const out = new THREE.Matrix4();
    field.getInstanceMatrix('oak', 0, out);
    const scale = new THREE.Vector3();
    out.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(Number.isFinite(scale.x)).toBe(true);
    expect(scale.x).toBeCloseTo(10, 6);
    expect(scale.y).toBeCloseTo(10, 6);
    expect(scale.z).toBeCloseTo(10, 6);
    field.dispose();
  });

  it('a zero instance scale yields a zero-scale matrix at the terrain position', () => {
    const trees: TreeInstances[] = [{ species: 'oak', data: [10, 20, 0, 0.5] }];
    const field = createTreeField(trees, [OAK], { factory: onePart, terrainY: () => 3 });
    const out = new THREE.Matrix4();
    field.getInstanceMatrix('oak', 0, out);
    expect(out.elements[0]).toBeCloseTo(0, 6);
    expect(out.elements[5]).toBeCloseTo(0, 6);
    expect(out.elements[10]).toBeCloseTo(0, 6);
    expect(out.elements[12]).toBeCloseTo(10, 6);
    expect(out.elements[13]).toBeCloseTo(3, 6);
    expect(out.elements[14]).toBeCloseTo(20, 6);
    field.dispose();
  });

  it('accessors on unknown species or out-of-range indices are inert', () => {
    const field = createTreeField([{ species: 'oak', data: [1, 2, 1, 0] }], [OAK], { factory: onePart, terrainY: flat() });
    expect(field.getInstanceLod('ghost', 0)).toBe(-1);
    expect(field.getInstanceLod('oak', -1)).toBe(-1);
    expect(field.getInstanceLod('oak', 1)).toBe(-1);
    const out = new THREE.Matrix4();
    field.getInstanceMatrix('oak', 0, out);
    const filled = out.clone();
    expect(field.getInstanceMatrix('oak', 5, out)).toBe(out);
    expect(out.equals(filled)).toBe(true);
    expect(field.getInstanceMatrix('ghost', 0, out).equals(filled)).toBe(true);
    field.dispose();
  });

  it('update evaluates each species independently', () => {
    const trees: TreeInstances[] = [
      { species: 'oak', data: [100, 0, 1, 0] },
      { species: 'pine', data: [2000, 0, 1, 0] },
    ];
    const field = createTreeField(trees, [OAK, PINE], { factory: onePart, terrainY: flat() });
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(0);
    expect(field.getInstanceLod('pine', 0)).toBe(-1);
    field.dispose();
  });

  it('scaleForHeight handles identity and zero-target cases', () => {
    expect(scaleForHeight(12, 12)).toBe(1);
    expect(scaleForHeight(12, 0)).toBe(0);
  });

  it('package.json pins both dependencies exactly', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@dgreenheck/ez-tree']).toBe('1.1.0');
    expect(pkg.dependencies['@three.ez/instanced-mesh']).toBe('0.3.16');
  });

  it('treeField.ts imports no Rapier, window or document', () => {
    const src = readFileSync(join(root, 'src/render/treeField.ts'), 'utf8');
    expect(src).not.toMatch(/@dimforge\/rapier|\bwindow\b|\bdocument\b/);
  });
});

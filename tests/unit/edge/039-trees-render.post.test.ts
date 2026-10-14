import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, scaleForHeight } from '../../../src/render/treeField';

// treeModels.ts lands with the coder (task 101); mirrors of the spec types keep this file type-checking.
interface TreeVariant {
  height: number;
  lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
}
type TreeModels = Record<'oak' | 'plane' | 'pine', TreeVariant[]>;

// Synthetic GLB-free models: Node unit tests must not load files.
function makeVariant(height: number): TreeVariant {
  const lod = (size: number): THREE.Mesh[] => [
    new THREE.Mesh(new THREE.BoxGeometry(size, height, size).translate(0, height / 2, 0), new THREE.MeshStandardMaterial()),
  ];
  return { height, lods: [lod(4), lod(2), lod(1)] };
}


const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function makeModels(height = 2): TreeModels {
  const four = (): TreeVariant[] => [0, 1, 2, 3].map(() => makeVariant(height));
  return { oak: four(), plane: four(), pine: four() };
}

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
    const field = createTreeField(trees, [OAK, PINE], { models: makeModels(), terrainY: flat() });
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
    const trees: TreeInstances[] = [
      { species: 'oak', data: [0, 0, 1, 0] },
      { species: 'ghost', data: [1, 1, 1, 0, 2, 2, 1, 0] },
    ];
    const field = createTreeField(trees, [OAK], { models: makeModels(), terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(1);
    expect(field.instanceCount('ghost')).toBe(0);
    expect(field.variantCount('ghost')).toBe(0);
    field.dispose();
  });

  it('a trailing incomplete record in data is ignored', () => {
    const trees: TreeInstances[] = [{ species: 'oak', data: [0, 0, 1, 0, 10, 10, 1, 0, 20] }];
    const field = createTreeField(trees, [OAK], { models: makeModels(), terrainY: flat() });
    expect(field.instanceCount('oak')).toBe(2);
    const out = new THREE.Matrix4();
    field.getInstanceMatrix('oak', 1, out);
    expect(out.elements[12]).toBeCloseTo(10, 6);
    field.dispose();
  });

  it('frustum culling is enabled on every instanced mesh', () => {
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0] }], [OAK], { models: makeModels(), terrainY: flat() });
    expect(field.object.children.length).toBeGreaterThan(0);
    for (const child of field.object.children) expect((child as THREE.Mesh).frustumCulled).toBe(true);
    field.dispose();
  });

  it('dispose() disposes every instanced mesh and is safe to call twice', () => {
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0, 5, 5, 1, 0] }], [OAK], { models: makeModels(), terrainY: flat() });
    const meshes = [...field.object.children] as unknown as InstancedMesh2[];
    const spies = meshes.map((mesh) => vi.spyOn(mesh, 'dispose'));
    field.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(() => field.dispose()).not.toThrow();
  });

  it('a variant with zero bounding-box height falls back to 1 m so instance scale stays finite', () => {
    const models = makeModels(0);
    const field = createTreeField([{ species: 'oak', data: [0, 0, 1, 0] }], [OAK], { models, terrainY: flat() });
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
    const field = createTreeField(trees, [OAK], { models: makeModels(), terrainY: () => 3 });
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
    const field = createTreeField([{ species: 'oak', data: [1, 2, 1, 0] }], [OAK], { models: makeModels(), terrainY: flat() });
    const valid: number[] = [0, 1, 2];
    expect(valid).not.toContain(field.getInstanceLod('ghost', 0));
    expect(valid).not.toContain(field.getInstanceLod('oak', -1));
    expect(valid).not.toContain(field.getInstanceLod('oak', 1));
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
    const field = createTreeField(trees, [OAK, PINE], { models: makeModels(), terrainY: flat() });
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(1);
    expect(field.getInstanceLod('pine', 0)).toBe(2);
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

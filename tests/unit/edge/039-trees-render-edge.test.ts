import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField } from '../../../src/render/treeField';

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

const VARIANT_HEIGHT = [2, 4, 8, 16];

function makeModels(heights: number[] = VARIANT_HEIGHT): TreeModels {
  const four = (): TreeVariant[] => heights.map(makeVariant);
  return { oak: four(), plane: four(), pine: four() };
}

// name !== preset: lookups go by name.
const SPECIES: TreeSpecies = { name: 'birch', preset: 'birch-preset', heightMeters: 10 };

function makeField(data: number[]) {
  const trees: TreeInstances[] = [{ species: 'birch', data }];
  const field = createTreeField(trees, [SPECIES], { models: makeModels(), terrainY: () => 0 });
  return { field };
}

describe('039 trees render edge', () => {
  it('EDGE2: instance i uses variant i % 4, matrix scales by that variant LOD0 height and follows data order', () => {
    const data: number[] = [];
    for (let i = 0; i < 8; i++) data.push(i * 10, 0, 2, 0);
    const { field } = makeField(data);
    const out = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      field.getInstanceMatrix('birch', i, out).decompose(position, quaternion, scale);
      expect(position.x).toBeCloseTo(i * 10, 6);
      const variantHeight = VARIANT_HEIGHT[i % 4];
      const expected = 2 * (10 / variantHeight);
      expect(scale.x).toBeCloseTo(expected, 6);
      expect(scale.y).toBeCloseTo(expected, 6);
      expect(scale.z).toBeCloseTo(expected, 6);
    }
    field.dispose();
  });

  it('EDGE3: species with empty data gives instanceCount 0, variantCount 4', () => {
    const { field } = makeField([]);
    expect(field.instanceCount('birch')).toBe(0);
    expect(field.variantCount('birch')).toBe(4);
    field.dispose();
  });

  it('EDGE5: LOD distance is horizontal, ignoring camera height', () => {
    const { field } = makeField([50, 0, 1, 0, 2000, 0, 1, 0]);
    field.update({ x: 0, y: 5000, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(2);
    field.dispose();
  });

  it('EDGE7: repeated update calls re-evaluate LODs as the camera moves and return them on the way back', () => {
    const { field } = makeField([50, 0, 1, 0, 150, 0, 1, 0]);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    field.update({ x: 0, y: 0, z: 2000 });
    expect(field.getInstanceLod('birch', 0)).toBe(2);
    expect(field.getInstanceLod('birch', 1)).toBe(2);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    field.dispose();
  });
});

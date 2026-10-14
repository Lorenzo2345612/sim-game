import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, scaleForHeight } from '../../../src/render/treeField';

// treeModels.ts lands with the coder (task 101); mirrors of the spec types keep this file type-checking.
interface TreeVariant {
  height: number;
  lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
}
type TreeModels = Record<'oak' | 'plane' | 'pine', TreeVariant[]>;


const VARIANT_HEIGHT = 2;

const createdGeometries: THREE.BufferGeometry[] = [];
const createdMaterials: THREE.Material[] = [];

// Synthetic GLB-free models: every variant has height 2 (2-part lods: trunk + leaves).
function makeVariant(height: number): TreeVariant {
  const lod = (size: number): THREE.Mesh[] => {
    const trunkGeometry = new THREE.BoxGeometry(0.2, 1, 0.2).translate(0, 0.5, 0);
    const leavesGeometry = new THREE.BoxGeometry(size, 1, size).translate(0, 1.5, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x2e8b57 });
    createdGeometries.push(trunkGeometry, leavesGeometry);
    createdMaterials.push(trunkMaterial, leavesMaterial);
    return [new THREE.Mesh(trunkGeometry, trunkMaterial), new THREE.Mesh(leavesGeometry, leavesMaterial)];
  };
  return { height, lods: [lod(1.5), lod(1), lod(0.5)] };
}

function makeModels(): TreeModels {
  const four = (): TreeVariant[] => [0, 1, 2, 3].map(() => makeVariant(VARIANT_HEIGHT));
  return { oak: four(), plane: four(), pine: four() };
}

function speciesList(): TreeSpecies[] {
  return [
    { name: 'oak', preset: 'oak', heightMeters: 10 },
    { name: 'pine', preset: 'pine', heightMeters: 6 },
  ];
}

function instances(speciesName: string, count: number): TreeInstances {
  const data: number[] = [];
  for (let n = 0; n < count; n++) {
    data.push(n * 3, n * 7, 1 + (n % 4) * 0.25, (n % 8) * 0.5);
  }
  return { species: speciesName, data };
}

function flatTerrain(): (x: number, z: number) => number {
  return () => 0;
}

describe('039 trees render acceptance', () => {
  it('AT1: instance count per species is 120 / 80 across its variants and each species uses 4 variants', () => {
    createdGeometries.length = 0;
    createdMaterials.length = 0;
    const trees = [instances('oak', 120), instances('pine', 80)];
    const field = createTreeField(trees, speciesList(), { models: makeModels(), terrainY: flatTerrain() });
    expect(field.instanceCount('oak')).toBe(120);
    expect(field.variantCount('oak')).toBe(4);
    expect(field.instanceCount('pine')).toBe(80);
    expect(field.variantCount('pine')).toBe(4);
    field.dispose();
  });

  it('AT2: instance matrix is position (x, terrainY(x,z), z), uniform scale = instance scale * heightMeters / variant height, rotation Y = rotY', () => {
    createdGeometries.length = 0;
    createdMaterials.length = 0;
    const terrainY = (x: number, z: number) => 0.5 * x + 0.25 * z;
    const oak: TreeInstances = { species: 'oak', data: [10, 20, 0.8, 0.3, -30, 40, 1.2, -1.0, 100, -200, 0.5, 2.5, 7, 7, 1, 0] };
    const pine: TreeInstances = { species: 'pine', data: [50, 50, 2, 1.5] };
    const field = createTreeField([oak, pine], speciesList(), { models: makeModels(), terrainY });
    const out = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const expected = [
      { species: 'oak', index: 0, x: 10, z: 20, y: 10, uniform: 0.8 * (10 / VARIANT_HEIGHT), rotY: 0.3 },
      { species: 'oak', index: 1, x: -30, z: 40, y: -5, uniform: 1.2 * (10 / VARIANT_HEIGHT), rotY: -1.0 },
      { species: 'oak', index: 2, x: 100, z: -200, y: 0, uniform: 0.5 * (10 / VARIANT_HEIGHT), rotY: 2.5 },
      { species: 'oak', index: 3, x: 7, z: 7, y: 5.25, uniform: 1 * (10 / VARIANT_HEIGHT), rotY: 0 },
      { species: 'pine', index: 0, x: 50, z: 50, y: 37.5, uniform: 2 * (6 / VARIANT_HEIGHT), rotY: 1.5 },
    ];
    for (const e of expected) {
      field.getInstanceMatrix(e.species, e.index, out).decompose(position, quaternion, scale);
      expect(position.x).toBeCloseTo(e.x, 6);
      expect(position.y).toBeCloseTo(e.y, 6);
      expect(position.z).toBeCloseTo(e.z, 6);
      expect(scale.x).toBeCloseTo(e.uniform, 6);
      expect(scale.y).toBeCloseTo(e.uniform, 6);
      expect(scale.z).toBeCloseTo(e.uniform, 6);
      euler.setFromQuaternion(quaternion);
      expect(euler.y).toBeCloseTo(e.rotY, 6);
      expect(euler.x).toBeCloseTo(0, 6);
      expect(euler.z).toBeCloseTo(0, 6);
    }
    field.dispose();
  });

  it('AT3: camera at origin, trees at 100 m / 400 m / 2000 m use LOD 1 / 2 / 2 (never culled)', () => {
    createdGeometries.length = 0;
    createdMaterials.length = 0;
    const trees: TreeInstances[] = [{ species: 'oak', data: [100, 0, 1, 0, 400, 0, 1, 0, 2000, 0, 1, 0] }];
    const field = createTreeField(trees, [speciesList()[0]], { models: makeModels(), terrainY: flatTerrain() });
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(1);
    expect(field.getInstanceLod('oak', 1)).toBe(2);
    expect(field.getInstanceLod('oak', 2)).toBe(2);
    field.dispose();
  });

  it('AT4: scaleForHeight(45, 18) is 0.4 within 1e-9', () => {
    expect(Math.abs(scaleForHeight(45, 18) - 0.4)).toBeLessThanOrEqual(1e-9);
  });

  it('AT5: dispose() disposes all geometries and materials', () => {
    createdGeometries.length = 0;
    createdMaterials.length = 0;
    const trees: TreeInstances[] = [instances('oak', 5)];
    const field = createTreeField(trees, [speciesList()[0]], { models: makeModels(), terrainY: flatTerrain() });
    const geometries = new Set<THREE.BufferGeometry>(createdGeometries);
    const materials = new Set<THREE.Material>(createdMaterials);
    field.object.traverse((object) => {
      const renderable = object as Partial<THREE.Mesh>;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        if (Array.isArray(renderable.material)) {
          for (const material of renderable.material) materials.add(material);
        } else {
          materials.add(renderable.material);
        }
      }
    });
    expect(geometries.size).toBeGreaterThan(0);
    expect(materials.size).toBeGreaterThan(0);
    const spies = [
      ...[...geometries].map((geometry) => vi.spyOn(geometry, 'dispose')),
      ...[...materials].map((material) => vi.spyOn(material, 'dispose')),
    ];
    field.dispose();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });
});

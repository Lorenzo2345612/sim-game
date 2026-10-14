import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, lodFor, type TreeField } from '../../../src/render/treeField';
import { bakedSpeciesFor, type TreeModels, type TreeVariant } from '../../../src/render/treeModels';

// Synthetic GLB-free models: Node unit tests must not load files.
function makeVariant(height: number): TreeVariant {
  const lod = (size: number): THREE.Mesh[] => [
    new THREE.Mesh(new THREE.BoxGeometry(size, height, size), new THREE.MeshStandardMaterial()),
  ];
  return { height, lods: [lod(4), lod(2), lod(1)] };
}

function makeModels(): TreeModels {
  return {
    oak: [10, 12, 14, 16].map(makeVariant),
    plane: [11, 13, 15, 17].map(makeVariant),
    pine: [18, 21, 24, 27].map(makeVariant),
  };
}

const OAK: TreeSpecies = { name: 'oak', preset: 'Oak Medium', heightMeters: 18 };
const PINE: TreeSpecies = { name: 'pine', preset: 'Pine Large', heightMeters: 26 };
const ASH: TreeSpecies = { name: 'ash', preset: 'Ash Medium', heightMeters: 16 };
const ASPEN: TreeSpecies = { name: 'aspen', preset: 'Aspen Medium', heightMeters: 14 };

function batchAt(name: string, xs: number[]): TreeInstances {
  const data: number[] = [];
  for (const x of xs) data.push(x, 0, 1, 0);
  return { species: name, data };
}

function countMeshes(field: TreeField): number {
  let n = 0;
  field.object.traverse((o) => {
    const mesh = o as InstancedMesh2;
    if (mesh.isInstancedMesh2) n++;
  });
  return n;
}

describe('101 tree lods edge', () => {
  it('EDGE1: lodFor uses exact 80/250 m thresholds and hysteresis in both directions at both thresholds', () => {
    expect(lodFor(0)).toBe(0);
    expect(lodFor(79)).toBe(0);
    expect(lodFor(80)).toBe(1);
    expect(lodFor(249)).toBe(1);
    expect(lodFor(250)).toBe(2);

    expect(lodFor(79, 1)).toBe(0);
    expect(lodFor(80, 1)).toBe(1);
    expect(lodFor(259, 1)).toBe(1);
    expect(lodFor(260, 1)).toBe(2);
    expect(lodFor(249, 2)).toBe(1);
    expect(lodFor(250, 2)).toBe(2);
  });

  it('EDGE2: lodFor jumps two levels only when both level conditions hold', () => {
    expect(lodFor(300, 0)).toBe(2);
    expect(lodFor(50, 2)).toBe(0);
    expect(lodFor(250, 0)).toBe(1);
    expect(lodFor(100, 2)).toBe(1);
  });

  it('EDGE3: bakedSpeciesFor maps ash and aspen to plane and unknown names to oak', () => {
    expect(bakedSpeciesFor('oak')).toBe('oak');
    expect(bakedSpeciesFor('ash')).toBe('plane');
    expect(bakedSpeciesFor('aspen')).toBe('plane');
    expect(bakedSpeciesFor('pine')).toBe('pine');
    expect(bakedSpeciesFor('birch')).toBe('oak');
    expect(bakedSpeciesFor('')).toBe('oak');
  });

  it('EDGE4: minLod clamps every instance LOD up and defaults to 0', () => {
    const trees = [batchAt('oak', [10, 400])];

    const def = createTreeField(trees, [OAK], { models: makeModels(), terrainY: () => 0 });
    def.update({ x: 0, y: 0, z: 0 });
    expect(def.getInstanceLod('oak', 0)).toBe(0);
    expect(def.getInstanceLod('oak', 1)).toBe(2);
    expect(def.lodCounts()).toEqual([1, 0, 1]);
    def.dispose();

    const clamped = createTreeField(trees, [OAK], { models: makeModels(), terrainY: () => 0, minLod: 1 });
    clamped.update({ x: 0, y: 0, z: 0 });
    expect(clamped.getInstanceLod('oak', 0)).toBe(1);
    expect(clamped.getInstanceLod('oak', 1)).toBe(2);
    expect(clamped.lodCounts()).toEqual([0, 1, 1]);
    clamped.update({ x: 0, y: 0, z: 0 });
    expect(clamped.getInstanceLod('oak', 0)).toBe(1);
    expect(clamped.lodCounts()).toEqual([0, 1, 1]);
    clamped.dispose();

    const all = createTreeField(trees, [OAK], { models: makeModels(), terrainY: () => 0, minLod: 2 });
    all.update({ x: 0, y: 0, z: 0 });
    expect(all.getInstanceLod('oak', 0)).toBe(2);
    expect(all.getInstanceLod('oak', 1)).toBe(2);
    expect(all.lodCounts()).toEqual([0, 0, 2]);
    all.dispose();
  });

  it('EDGE5: instance matrix uses variant i % 4 height, terrainY for y and rotY from the data', () => {
    const data = [0, 0, 2, 0, 10, 5, 1, Math.PI / 2, 0, 0, 1, 0, 0, 0, 1, 0, 40, 0, 3, 0];
    const field = createTreeField([{ species: 'oak', data }], [OAK], {
      models: makeModels(),
      terrainY: (x, z) => x * 0.1 + z,
    });
    const out = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    field.getInstanceMatrix('oak', 0, out).decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(0, 6);
    expect(position.y).toBeCloseTo(0, 6);
    expect(position.z).toBeCloseTo(0, 6);
    expect(scale.x).toBeCloseTo(2 * 18 / 10, 6);
    expect(scale.y).toBeCloseTo(2 * 18 / 10, 6);
    expect(scale.z).toBeCloseTo(2 * 18 / 10, 6);

    field.getInstanceMatrix('oak', 1, out).decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(10, 6);
    expect(position.y).toBeCloseTo(6, 6);
    expect(position.z).toBeCloseTo(5, 6);
    expect(scale.x).toBeCloseTo(1 * 18 / 12, 6);
    expect(quaternion.x).toBeCloseTo(0, 6);
    expect(quaternion.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(quaternion.z).toBeCloseTo(0, 6);
    expect(quaternion.w).toBeCloseTo(Math.SQRT1_2, 6);

    field.getInstanceMatrix('oak', 4, out).decompose(position, quaternion, scale);
    expect(position.x).toBeCloseTo(40, 6);
    expect(scale.x).toBeCloseTo(3 * 18 / 10, 6);

    field.dispose();
  });

  it('EDGE6: update measures horizontal distance only and never culls past LOD 2', () => {
    const field = createTreeField([batchAt('oak', [10, 10000])], [OAK], {
      models: makeModels(),
      terrainY: () => 0,
    });
    field.update({ x: 0, y: 5000, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(0);
    expect(field.getInstanceLod('oak', 1)).toBe(2);
    field.dispose();
  });

  it('EDGE7: lodCounts tracks each LOD across camera moves and keeps summing to the tree count', () => {
    const field = createTreeField([batchAt('oak', [10, 100, 400]), batchAt('pine', [95])], [OAK, PINE], {
      models: makeModels(),
      terrainY: () => 0,
    });
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.lodCounts()).toEqual([1, 2, 1]);
    expect(field.lodCounts()[0] + field.lodCounts()[1] + field.lodCounts()[2]).toBe(4);

    field.update({ x: 300, y: 0, z: 0 });
    expect(field.lodCounts()).toEqual([0, 2, 2]);
    expect(field.lodCounts()[0] + field.lodCounts()[1] + field.lodCounts()[2]).toBe(4);
    field.dispose();
  });

  it('EDGE8: dispose releases every tree geometry and material exactly once across two calls', () => {
    const models = makeModels();
    const geoHits = new Map<THREE.BufferGeometry, number>();
    const matHits = new Map<THREE.Material, number>();
    for (const variant of models.oak) {
      for (const part of variant.lods) {
        for (const mesh of part) {
          const geometry = mesh.geometry;
          if (!geoHits.has(geometry)) {
            geoHits.set(geometry, 0);
            geometry.addEventListener('dispose', () => geoHits.set(geometry, (geoHits.get(geometry) ?? 0) + 1));
          }
          const material = mesh.material as THREE.Material;
          if (!matHits.has(material)) {
            matHits.set(material, 0);
            material.addEventListener('dispose', () => matHits.set(material, (matHits.get(material) ?? 0) + 1));
          }
        }
      }
    }
    expect(geoHits.size).toBe(12);
    expect(matHits.size).toBe(12);

    const field = createTreeField([batchAt('oak', [10, 20, 30, 40, 50])], [OAK], {
      models,
      terrainY: () => 0,
    });
    field.dispose();
    field.dispose();

    for (const [geometry, n] of geoHits) expect(n, `geometry ${geometry.uuid}`).toBe(1);
    for (const [material, n] of matHits) expect(n, `material ${material.uuid}`).toBe(1);
  });

  it('EDGE9: createTreeField and update leave TreeInstances.data untouched', () => {
    const trees = [batchAt('oak', [10, 20, 30]), batchAt('pine', [40, 50])];
    const snapshots = trees.map((t) => [...t.data]);
    const field = createTreeField(trees, [OAK, PINE], { models: makeModels(), terrainY: () => 0 });
    field.update({ x: 0, y: 0, z: 0 });
    field.update({ x: 1000, y: 0, z: 0 });
    expect(trees.map((t) => t.data)).toEqual(snapshots);
    field.dispose();
  });

  it('EDGE10: meshes are created per baked species, variant, lod and part only for species present', () => {
    const f1 = createTreeField([batchAt('oak', [0, 60, 120, 180, 240])], [OAK, PINE], {
      models: makeModels(),
      terrainY: () => 0,
    });
    expect(countMeshes(f1)).toBe(12);
    f1.dispose();

    const f2 = createTreeField(
      [batchAt('ash', [0, 60]), batchAt('aspen', [120, 180]), batchAt('oak', [240, 300])],
      [ASH, ASPEN, OAK],
      { models: makeModels(), terrainY: () => 0 },
    );
    expect(countMeshes(f2)).toBe(24);
    f2.dispose();
  });
});

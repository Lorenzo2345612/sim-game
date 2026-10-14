import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import * as treeFieldModule from '../../../src/render/treeField';

// treeModels.ts and the new treeField members land with the coder; these mirrors of the
// spec signatures keep the file type-checking until then (pattern of the 043 e2e test).
type Lod = 0 | 1 | 2;
interface TreeVariant {
  height: number;
  lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
}
type TreeModels = Record<'oak' | 'plane' | 'pine', TreeVariant[]>;

const { createTreeField } = treeFieldModule;
const lodFor = (treeFieldModule as unknown as { lodFor(distance: number, current?: Lod): Lod }).lodFor;

// Synthetic GLB-free models: Node unit tests must not load files.
function makeVariant(height: number): TreeVariant {
  const lod = (size: number): THREE.Mesh[] => [
    new THREE.Mesh(new THREE.BoxGeometry(size, height, size), new THREE.MeshStandardMaterial()),
  ];
  return { height, lods: [lod(4), lod(2), lod(1)] };
}

const models: TreeModels = {
  oak: [10, 12, 14, 16].map(makeVariant),
  plane: [11, 13, 15, 17].map(makeVariant),
  pine: [18, 21, 24, 27].map(makeVariant),
};

const species: TreeSpecies[] = [
  { name: 'oak', preset: 'Oak Medium', heightMeters: 18 },
  { name: 'pine', preset: 'Pine Large', heightMeters: 26 },
];

const OAK_TREES = 41;
const PINE_TREES = 23;

function batch(name: string, count: number, z: number): TreeInstances {
  const data: number[] = [];
  for (let i = 0; i < count; i++) data.push(i * 60, z, 1, 0);
  return { species: name, data };
}

describe('101 tree lods acceptance', () => {
  it('AT1: lodFor maps 50/150/400 m to 0/1/2 and a LOD 0 tree stays at 0 until 90 m', () => {
    expect(lodFor(50)).toBe(0);
    expect(lodFor(150)).toBe(1);
    expect(lodFor(400)).toBe(2);
    expect(lodFor(89, 0)).toBe(0);
    expect(lodFor(90, 0)).toBe(1);
  });

  it('AT4: 1000 moving-camera updates keep instance matrices in place and LOD counts sum to the tree count', () => {
    const trees: TreeInstances[] = [batch('oak', OAK_TREES, 0), batch('pine', PINE_TREES, 50)];
    const options = { models, terrainY: () => 0 };
    const field = createTreeField(trees, species, options) as ReturnType<typeof createTreeField> & {
      lodCounts(): readonly [number, number, number];
    };

    const meshes: InstancedMesh2[] = [];
    field.object.traverse((o) => {
      const mesh = o as InstancedMesh2;
      if (mesh.isInstancedMesh2) meshes.push(mesh);
    });
    expect(meshes.length).toBeGreaterThan(0);

    const buffers = meshes.map((m) => m.matricesTexture.image.data!);
    const values = buffers.map((b) => Array.from(b));
    const countsBefore = field.lodCounts();

    const camera = { x: 0, y: 4, z: 0 };
    for (let i = 0; i < 1000; i++) {
      camera.x = i * 2;
      camera.z = 5 * Math.sin(i * 0.01);
      field.update(camera);
    }

    meshes.forEach((mesh, i) => {
      expect(mesh.matricesTexture.image.data).toBe(buffers[i]);
      expect(Array.from(mesh.matricesTexture.image.data!)).toEqual(values[i]);
    });
    const counts = field.lodCounts();
    expect(counts).toBe(countsBefore);
    expect(counts[0] + counts[1] + counts[2]).toBe(OAK_TREES + PINE_TREES);

    field.dispose();
  });
});

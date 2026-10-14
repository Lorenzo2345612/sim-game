import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField } from '../../../src/render/treeField';
import { loadTreeModels, type TreeModels, type TreeVariant } from '../../../src/render/treeModels';

const { loadAsyncMock } = vi.hoisted(() => ({ loadAsyncMock: vi.fn() }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync(url: string) {
      return loadAsyncMock(url);
    }
  },
}));

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
const ASH: TreeSpecies = { name: 'ash', preset: 'Ash Medium', heightMeters: 16 };
const ASPEN: TreeSpecies = { name: 'aspen', preset: 'Aspen Medium', heightMeters: 14 };

function batchAt(name: string, xs: number[]): TreeInstances {
  const data: number[] = [];
  for (const x of xs) data.push(x, 0, 1, 0);
  return { species: name, data };
}

function readMatrix(field: ReturnType<typeof createTreeField>, species: string, index: number) {
  const out = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  field.getInstanceMatrix(species, index, out).decompose(position, quaternion, scale);
  return { position, scale };
}

describe('101 tree lods post-code edge', () => {
  it('update holds the LOD inside the hysteresis band per instance', () => {
    const field = createTreeField([batchAt('oak', [0])], [OAK], { models: makeModels(), terrainY: () => 0 });
    field.update({ x: 85, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(0); // 85 < 80+10: no promote yet
    field.update({ x: 90, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(1);
    field.update({ x: 85, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(1); // 85 >= 80: no demote back
    field.update({ x: 79, y: 0, z: 0 });
    expect(field.getInstanceLod('oak', 0)).toBe(0);
    expect(field.lodCounts()).toEqual([1, 0, 0]);
    field.dispose();
  });

  it('update leaves exactly the target LOD mesh visible for an instance', () => {
    const field = createTreeField([batchAt('oak', [0])], [OAK], { models: makeModels(), terrainY: () => 0 });
    const vis = (lod: number) =>
      (field.object.getObjectByName(`oak-v${0}-lod${lod}-p0`) as unknown as InstancedMesh2).getVisibilityAt(0);
    field.update({ x: 10, y: 0, z: 0 });
    expect([vis(0), vis(1), vis(2)]).toEqual([true, false, false]);
    field.update({ x: 260, y: 0, z: 0 });
    expect([vis(0), vis(1), vis(2)]).toEqual([false, false, true]); // 0→2 double jump
    field.update({ x: 100, y: 0, z: 0 });
    expect([vis(0), vis(1), vis(2)]).toEqual([false, true, false]); // 2→1 only
    field.dispose();
  });

  it('counts instances across batches of one species and ignores trailing floats', () => {
    const a: TreeInstances = { species: 'oak', data: [0, 0, 1, 0, 50, 0, 1, 0] };
    const b: TreeInstances = { species: 'oak', data: [100, 0, 1, 0, 150, 0, 1, 0, 7, 7] };
    const field = createTreeField([a, b], [OAK], { models: makeModels(), terrainY: () => 0 });
    expect(field.instanceCount('oak')).toBe(4);
    const m2 = readMatrix(field, 'oak', 2);
    expect(m2.position.x).toBeCloseTo(100, 6);
    expect(m2.scale.x).toBeCloseTo(18 / 14, 6); // global slot 2 → variant 2
    const m3 = readMatrix(field, 'oak', 3);
    expect(m3.scale.x).toBeCloseTo(18 / 16, 6);
    expect(field.getInstanceLod('oak', 4)).toBe(-1);
    expect(field.getInstanceLod('oak', -1)).toBe(-1);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.lodCounts()).toEqual([2, 2, 0]); // truncated floats left no 5th instance
    field.dispose();
  });

  it('species sharing a bake continue the variant slot offset across species', () => {
    const field = createTreeField(
      [batchAt('ash', [0, 60]), batchAt('aspen', [120, 180])],
      [ASH, ASPEN],
      { models: makeModels(), terrainY: () => 0 },
    );
    const m0 = readMatrix(field, 'aspen', 0);
    expect(m0.position.x).toBeCloseTo(120, 6);
    expect(m0.scale.x).toBeCloseTo(14 / 15, 6); // aspen slot 2 → plane variant height 15, not 11
    const m1 = readMatrix(field, 'aspen', 1);
    expect(m1.scale.x).toBeCloseTo(14 / 17, 6);
    expect(field.object.getObjectByName('plane-v0-lod0-p0')).toBeInstanceOf(THREE.Object3D);
    expect(field.object.getObjectByName('oak-v0-lod0-p0')).toBeUndefined(); // oak absent from track
    field.dispose();
  });

  it('zero-height variants fall back to height 1 instead of dividing by zero', () => {
    const models = makeModels();
    models.oak[0] = makeVariant(0);
    const field = createTreeField([batchAt('oak', [0])], [OAK], { models, terrainY: () => 0 });
    const m = readMatrix(field, 'oak', 0);
    expect(m.scale.x).toBeCloseTo(18, 6);
    expect(Number.isFinite(m.scale.x)).toBe(true);
    field.dispose();
  });

  it('empty trees array builds a mesh-less field that survives update and dispose', () => {
    const field = createTreeField([], [OAK], { models: makeModels(), terrainY: () => 0 });
    expect(field.object.children).toHaveLength(0);
    expect(field.lodCounts()).toEqual([0, 0, 0]);
    expect(field.instanceCount('oak')).toBe(0);
    expect(() => field.update({ x: 0, y: 0, z: 0 })).not.toThrow();
    expect(() => field.dispose()).not.toThrow();
  });

  function fakeScene(height: number, withLod2 = true): THREE.Scene {
    const scene = new THREE.Scene();
    for (let l = 0; l < 3; l++) {
      if (l === 2 && !withLod2) break;
      const node = new THREE.Group();
      node.name = `lod${l}`;
      node.add(new THREE.Mesh(new THREE.BoxGeometry(1, l === 0 ? height : 1, 1), new THREE.MeshBasicMaterial()));
      scene.add(node);
    }
    return scene;
  }

  it('loadTreeModels fetches the 12 baked GLBs and indexes them per species and variant', async () => {
    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation((url: string) => {
      const m = /trees\/(oak|plane|pine)-([0-3])\.glb$/.exec(url);
      expect(m, `url ${url}`).not.toBeNull();
      return Promise.resolve({ scene: fakeScene(10 + Number(m![2])) });
    });
    const models = await loadTreeModels();
    expect(loadAsyncMock).toHaveBeenCalledTimes(12);
    expect(loadAsyncMock).toHaveBeenCalledWith('/models/trees/pine-3.glb');
    expect(models.oak.map((v) => v.height)).toEqual([10, 11, 12, 13]); // height from lod0 bbox only
    expect(models.plane.map((v) => v.height)).toEqual([10, 11, 12, 13]);
    const mesh = models.pine[2].lods[1][0];
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);

    loadAsyncMock.mockClear();
    await loadTreeModels('https://cdn/trees/');
    expect(loadAsyncMock).toHaveBeenCalledTimes(12);
    expect(loadAsyncMock.mock.calls[0][0]).toBe('https://cdn/trees/oak-0.glb');
  });

  it('loadTreeModels rejects when a lod node is missing', async () => {
    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(() => Promise.resolve({ scene: fakeScene(10, false) }));
    await expect(loadTreeModels()).rejects.toThrow(/Missing lod2/);
  });

  it('loadTreeModels falls back to height 1 for a zero-height lod0 bbox', async () => {
    loadAsyncMock.mockReset();
    loadAsyncMock.mockImplementation(() => Promise.resolve({ scene: fakeScene(0) }));
    const models = await loadTreeModels();
    expect(models.oak[0].height).toBe(1);
    expect(models.pine[3].height).toBe(1);
  });
});

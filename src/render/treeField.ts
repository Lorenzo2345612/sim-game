import * as THREE from 'three';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies, Vec3 } from '../core/types';

export type TreeFactory = (preset: string, seed: number, leafFactor: number) => THREE.Group;

export interface TreeFieldOptions {
  factory?: TreeFactory;
  terrainY: (x: number, z: number) => number;
  lodDistance?: number;
  farDistance?: number;
}

export interface TreeField {
  object: THREE.Group;
  update(cameraPosition: Vec3): void;
  instanceCount(species: string): number;
  variantCount(species: string): number;
  getInstanceLod(species: string, index: number): 0 | 1 | -1;
  getInstanceMatrix(species: string, index: number, out: THREE.Matrix4): THREE.Matrix4;
  dispose(): void;
}

export function scaleForHeight(variantHeight: number, targetHeight: number): number {
  return targetHeight / variantHeight;
}

const VARIANT_SEEDS = [1, 2, 3];
const VARIANT_COUNT = VARIANT_SEEDS.length;
const LOD_LEAF_FACTORS = [1, 0.5];
const LOD_COUNT = LOD_LEAF_FACTORS.length;
const DEFAULT_LOD_DISTANCE = 250;
const DEFAULT_FAR_DISTANCE = 1500;
const STRIDE = 5; // x, y, z, scale, rotY

// ez-tree loads its textures at module scope through TextureLoader, which needs a DOM.
// Load it lazily so this module stays importable in Node-based tests.
type EzTreeModule = typeof import('@dgreenheck/ez-tree');
let ezTree: EzTreeModule | undefined;
try {
  ezTree = await import('@dgreenheck/ez-tree');
} catch {
  ezTree = undefined;
}

function defaultFactory(preset: string, seed: number, leafFactor: number): THREE.Group {
  if (!ezTree) throw new Error('EZ-Tree unavailable: pass options.factory');
  const tree = new ezTree.Tree();
  const presets = ezTree.TreePreset as unknown as Record<string, Parameters<typeof tree.options.copy>[0] | undefined>;
  const json = presets[preset];
  if (json) tree.options.copy(json);
  tree.options.seed = seed;
  tree.options.leaves.count = Math.max(1, Math.round(tree.options.leaves.count * leafFactor));
  tree.generate();
  return tree;
}

const TEMP_BOX = new THREE.Box3();
const TEMP_MATRIX = new THREE.Matrix4();
const TEMP_POSITION = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();
const TEMP_EULER = new THREE.Euler();
const TEMP_SCALE = new THREE.Vector3();

function composeMatrix(
  x: number,
  y: number,
  z: number,
  scale: number,
  rotY: number,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  TEMP_EULER.set(0, rotY, 0);
  TEMP_POSITION.set(x, y, z);
  TEMP_QUATERNION.setFromEuler(TEMP_EULER);
  TEMP_SCALE.setScalar(scale);
  return out.compose(TEMP_POSITION, TEMP_QUATERNION, TEMP_SCALE);
}

function groupHeight(group: THREE.Object3D): number {
  TEMP_BOX.setFromObject(group);
  const height = TEMP_BOX.max.y - TEMP_BOX.min.y;
  return height > 0 ? height : 1;
}

function collectParts(group: THREE.Object3D): THREE.Mesh[] {
  const parts: THREE.Mesh[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) parts.push(mesh);
  });
  return parts;
}

interface Variant {
  height: number;
  lods: InstancedMesh2[][]; // [lod][part]
}

interface SpeciesState {
  count: number;
  data: Float32Array;
  lods: Int8Array;
  uniformScales: Float32Array;
  variants: Variant[];
}

export function createTreeField(
  trees: TreeInstances[],
  species: TreeSpecies[],
  options: TreeFieldOptions,
): TreeField {
  const factory = options.factory ?? defaultFactory;
  const { terrainY } = options;
  const lodDistance = options.lodDistance ?? DEFAULT_LOD_DISTANCE;
  const farDistance = options.farDistance ?? DEFAULT_FAR_DISTANCE;

  const object = new THREE.Group();
  object.name = 'TreeField';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const meshes: InstancedMesh2[] = [];
  const states = new Map<string, SpeciesState>();

  for (const spec of species) {
    let count = 0;
    for (const batch of trees) {
      if (batch.species === spec.name) count += Math.floor(batch.data.length / 4);
    }
    const data = new Float32Array(count * STRIDE);
    const lods = new Int8Array(count).fill(-1);
    const uniformScales = new Float32Array(count);

    const variants: Variant[] = [];
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const variantCount = count > v ? Math.ceil((count - v) / VARIANT_COUNT) : 0;
      const levels: InstancedMesh2[][] = [];
      let height = 1;
      for (let l = 0; l < LOD_COUNT; l++) {
        const group = factory(spec.preset, VARIANT_SEEDS[v], LOD_LEAF_FACTORS[l]);
        const parts = collectParts(group);
        for (const part of parts) {
          if (part.geometry) geometries.push(part.geometry);
          if (Array.isArray(part.material)) materials.push(...part.material);
          else if (part.material) materials.push(part.material);
        }
        if (l === 0) height = groupHeight(group);
        const level: InstancedMesh2[] = [];
        for (let p = 0; p < parts.length; p++) {
          const source = parts[p];
          const mesh = new InstancedMesh2(source.geometry, source.material, { capacity: Math.max(variantCount, 1) });
          mesh.name = `${spec.name}-v${v}-lod${l}-p${p}`;
          if (variantCount > 0) mesh.addInstances(variantCount);
          object.add(mesh);
          meshes.push(mesh);
          level.push(mesh);
        }
        levels.push(level);
      }
      variants.push({ height, lods: levels });
    }

    let index = 0;
    for (const batch of trees) {
      if (batch.species !== spec.name) continue;
      const n = Math.floor(batch.data.length / 4);
      for (let k = 0; k < n; k++, index++) {
        const x = batch.data[k * 4];
        const z = batch.data[k * 4 + 1];
        const instanceScale = batch.data[k * 4 + 2];
        const rotY = batch.data[k * 4 + 3];
        const y = terrainY(x, z);
        const uniform = instanceScale * scaleForHeight(variants[index % VARIANT_COUNT].height, spec.heightMeters);
        const base = index * STRIDE;
        data[base] = x;
        data[base + 1] = y;
        data[base + 2] = z;
        data[base + 3] = instanceScale;
        data[base + 4] = rotY;
        uniformScales[index] = uniform;
        const variant = index % VARIANT_COUNT;
        const local = Math.floor(index / VARIANT_COUNT);
        composeMatrix(x, y, z, uniform, rotY, TEMP_MATRIX);
        for (const level of variants[variant].lods) {
          for (const mesh of level) {
            mesh.setMatrixAt(local, TEMP_MATRIX);
            mesh.setVisibilityAt(local, false);
          }
        }
      }
    }

    states.set(spec.name, { count, data, lods, uniformScales, variants });
  }

  let disposed = false;
  return {
    object,
    update(cameraPosition: Vec3): void {
      for (const state of states.values()) {
        const { data: d, lods: level, variants: vs } = state;
        for (let i = 0; i < state.count; i++) {
          const dx = d[i * STRIDE] - cameraPosition.x;
          const dz = d[i * STRIDE + 2] - cameraPosition.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          const lod = distance < lodDistance ? 0 : distance < farDistance ? 1 : -1;
          if (lod === level[i]) continue;
          level[i] = lod;
          const variant = i % VARIANT_COUNT;
          const local = Math.floor(i / VARIANT_COUNT);
          for (let l = 0; l < LOD_COUNT; l++) {
            for (const mesh of vs[variant].lods[l]) mesh.setVisibilityAt(local, l === lod);
          }
        }
      }
    },
    instanceCount(speciesName: string): number {
      return states.get(speciesName)?.count ?? 0;
    },
    variantCount(speciesName: string): number {
      return states.has(speciesName) ? VARIANT_COUNT : 0;
    },
    getInstanceLod(speciesName: string, index: number): 0 | 1 | -1 {
      const state = states.get(speciesName);
      if (!state || index < 0 || index >= state.count) return -1;
      return state.lods[index] as 0 | 1 | -1;
    },
    getInstanceMatrix(speciesName: string, index: number, out: THREE.Matrix4): THREE.Matrix4 {
      const state = states.get(speciesName);
      if (!state || index < 0 || index >= state.count) return out;
      const base = index * STRIDE;
      return composeMatrix(
        state.data[base],
        state.data[base + 1],
        state.data[base + 2],
        state.uniformScales[index],
        state.data[base + 4],
        out,
      );
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) {
        mesh.dispose();
        object.remove(mesh);
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

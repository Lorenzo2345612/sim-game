import * as THREE from 'three';
import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import type { TreeInstances, TreeSpecies, Vec3 } from '../core/types';
import { bakedSpeciesFor, type BakedSpecies, type TreeModels } from './treeModels';

export type Lod = 0 | 1 | 2;

export interface TreeFieldOptions {
  models: TreeModels;
  terrainY: (x: number, z: number) => number;
  minLod?: Lod;
}

export interface TreeField {
  object: THREE.Group;
  update(cameraPosition: Vec3): void;
  instanceCount(species: string): number;
  variantCount(species: string): number;
  getInstanceLod(species: string, index: number): Lod | -1;
  getInstanceMatrix(species: string, index: number, out: THREE.Matrix4): THREE.Matrix4;
  lodCounts(): readonly [number, number, number];
  dispose(): void;
}

export function scaleForHeight(variantHeight: number, targetHeight: number): number {
  return targetHeight / variantHeight;
}

const LOD_THRESHOLDS: readonly number[] = [80, 250];
const LOD_HYSTERESIS = 10;
const LOD_LEVELS = 3;
const VARIANT_COUNT = 4;
const STRIDE = 5; // x, y, z, scale, rotY

// Coarser moves need threshold + hysteresis; finer moves and the no-current form use
// the raw thresholds. Multi-level jumps happen when every level condition holds.
export function lodFor(distance: number, current?: Lod): Lod {
  if (current === undefined) {
    return distance < LOD_THRESHOLDS[0] ? 0 : distance < LOD_THRESHOLDS[1] ? 1 : 2;
  }
  let lod = current;
  while (lod > 0 && distance < LOD_THRESHOLDS[lod - 1]) lod--;
  while (lod < LOD_LEVELS - 1 && distance >= LOD_THRESHOLDS[lod] + LOD_HYSTERESIS) lod++;
  return lod as Lod;
}

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

function collectMaterials(material: THREE.Material | THREE.Material[], out: Set<THREE.Material>): void {
  if (Array.isArray(material)) {
    for (const part of material) out.add(part);
  } else {
    out.add(material);
  }
}

interface Variant {
  height: number;
  lods: InstancedMesh2[][]; // [lod][part]
}

// One mesh set per baked species; track species sharing a bake share the set, so each
// instance gets a global slot (offset + i) inside it: variant = slot % 4.
interface Group {
  variants: Variant[];
  next: number;
}

interface SpeciesState {
  count: number;
  offset: number;
  data: Float32Array;
  lods: Int8Array;
  uniformScales: Float32Array;
  variants: Variant[];
}

function createVariants(
  model: TreeModels[BakedSpecies],
  total: number,
  baked: string,
  object: THREE.Object3D,
  meshes: InstancedMesh2[],
): Variant[] {
  const variants: Variant[] = [];
  for (let v = 0; v < VARIANT_COUNT; v++) {
    const source = model[v];
    const capacity = total > v ? Math.ceil((total - v) / VARIANT_COUNT) : 0;
    const levels: InstancedMesh2[][] = [];
    for (let l = 0; l < LOD_LEVELS; l++) {
      const level: InstancedMesh2[] = [];
      const parts = source.lods[l];
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        const mesh = new InstancedMesh2(part.geometry, part.material, { capacity: Math.max(capacity, 1) });
        mesh.name = `${baked}-v${v}-lod${l}-p${p}`;
        if (capacity > 0) {
          mesh.addInstances(capacity);
          for (let i = 0; i < capacity; i++) mesh.setVisibilityAt(i, l === 0);
        }
        object.add(mesh);
        meshes.push(mesh);
        level.push(mesh);
      }
      levels.push(level);
    }
    variants.push({ height: source.height > 0 ? source.height : 1, lods: levels });
  }
  return variants;
}

export function createTreeField(
  trees: TreeInstances[],
  species: TreeSpecies[],
  options: TreeFieldOptions,
): TreeField {
  const { models, terrainY } = options;
  const minLod: Lod = options.minLod ?? 0;

  const object = new THREE.Group();
  object.name = 'TreeField';
  const meshes: InstancedMesh2[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const counts: [number, number, number] = [0, 0, 0];

  for (const variants of Object.values(models)) {
    for (const variant of variants) {
      for (const lod of variant.lods) {
        for (const part of lod) {
          if (part.geometry) geometries.add(part.geometry);
          collectMaterials(part.material, materials);
        }
      }
    }
  }

  const presentSpecies: TreeSpecies[] = [];
  const countOf = new Map<string, number>();
  for (const spec of species) {
    // One mesh set per species present in the track: any batch counts, even an empty one.
    if (!trees.some((batch) => batch.species === spec.name)) continue;
    let count = 0;
    for (const batch of trees) {
      if (batch.species === spec.name) count += Math.floor(batch.data.length / 4);
    }
    presentSpecies.push(spec);
    countOf.set(spec.name, count);
  }

  const totals = new Map<BakedSpecies, number>();
  for (const spec of presentSpecies) {
    const baked = bakedSpeciesFor(spec.name);
    totals.set(baked, (totals.get(baked) ?? 0) + countOf.get(spec.name)!);
  }

  const groups = new Map<BakedSpecies, Group>();
  for (const spec of presentSpecies) {
    const baked = bakedSpeciesFor(spec.name);
    if (!groups.has(baked)) {
      groups.set(baked, {
        variants: createVariants(models[baked], totals.get(baked)!, baked, object, meshes),
        next: 0,
      });
    }
  }

  const states = new Map<string, SpeciesState>();
  for (const spec of presentSpecies) {
    const group = groups.get(bakedSpeciesFor(spec.name))!;
    const count = countOf.get(spec.name)!;
    counts[0] += count;
    const offset = group.next;
    const data = new Float32Array(count * STRIDE);
    const lods = new Int8Array(count); // instances start at the finest level
    const uniformScales = new Float32Array(count);
    const variants = group.variants;

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
        const variant = (offset + index) % VARIANT_COUNT;
        const local = (offset + index - variant) / VARIANT_COUNT;
        const uniform = instanceScale * scaleForHeight(variants[variant].height, spec.heightMeters);
        const base = index * STRIDE;
        data[base] = x;
        data[base + 1] = y;
        data[base + 2] = z;
        data[base + 3] = instanceScale;
        data[base + 4] = rotY;
        uniformScales[index] = uniform;
        composeMatrix(x, y, z, uniform, rotY, TEMP_MATRIX);
        for (const level of variants[variant].lods) {
          for (const mesh of level) mesh.setMatrixAt(local, TEMP_MATRIX);
        }
      }
    }

    group.next += count;
    states.set(spec.name, { count, offset, data, lods, uniformScales, variants });
  }

  let disposed = false;
  return {
    object,
    update(cameraPosition: Vec3): void {
      for (const state of states.values()) {
        const { data: d, lods: level, variants: vs, offset } = state;
        for (let i = 0; i < state.count; i++) {
          const dx = d[i * STRIDE] - cameraPosition.x;
          const dz = d[i * STRIDE + 2] - cameraPosition.z;
          const lod = lodFor(Math.sqrt(dx * dx + dz * dz), level[i] as Lod);
          const target = lod > minLod ? lod : minLod;
          if (target === level[i]) continue;
          counts[level[i]]--;
          counts[target]++;
          level[i] = target;
          const variant = (offset + i) % VARIANT_COUNT;
          const local = (offset + i - variant) / VARIANT_COUNT;
          const levels = vs[variant].lods;
          for (let l = 0; l < LOD_LEVELS; l++) {
            const visible = l === target;
            for (const mesh of levels[l]) mesh.setVisibilityAt(local, visible);
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
    getInstanceLod(speciesName: string, index: number): Lod | -1 {
      const state = states.get(speciesName);
      if (!state || index < 0 || index >= state.count) return -1;
      return state.lods[index] as Lod;
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
    lodCounts(): readonly [number, number, number] {
      return counts;
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

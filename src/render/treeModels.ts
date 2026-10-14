import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type BakedSpecies = 'oak' | 'plane' | 'pine';

export interface TreeVariant {
  height: number;
  lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
}

export type TreeModels = Record<BakedSpecies, TreeVariant[]>;

const BAKED_SPECIES: readonly BakedSpecies[] = ['oak', 'plane', 'pine'];
const VARIANT_COUNT = 4;

export function bakedSpeciesFor(name: string): BakedSpecies {
  if (name === 'pine') return 'pine';
  if (name === 'ash' || name === 'aspen') return 'plane';
  return 'oak';
}

function collectMeshes(node: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  node.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  return meshes;
}

async function loadVariant(loader: GLTFLoader, url: string): Promise<TreeVariant> {
  const gltf = await loader.loadAsync(url);
  const nodes: THREE.Object3D[] = [];
  const lods: THREE.Mesh[][] = [];
  for (let l = 0; l < 3; l++) {
    const node = gltf.scene.getObjectByName(`lod${l}`);
    if (!node) throw new Error(`Missing lod${l} node in ${url}`);
    nodes.push(node);
    lods.push(collectMeshes(node));
  }
  const box = new THREE.Box3().setFromObject(nodes[0]);
  const height = box.max.y - box.min.y;
  return { height: height > 0 ? height : 1, lods } as TreeVariant;
}

export async function loadTreeModels(baseUrl = '/models/trees/'): Promise<TreeModels> {
  const loader = new GLTFLoader();
  const files: { species: BakedSpecies; variant: number; url: string }[] = [];
  for (const species of BAKED_SPECIES) {
    for (let v = 0; v < VARIANT_COUNT; v++) files.push({ species, variant: v, url: `${baseUrl}${species}-${v}.glb` });
  }
  const loaded = await Promise.all(
    files.map(async (file) => ({ species: file.species, index: file.variant, tree: await loadVariant(loader, file.url) })),
  );
  const models = { oak: [], plane: [], pine: [] } as TreeModels;
  for (const file of loaded) models[file.species][file.index] = file.tree;
  return models;
}

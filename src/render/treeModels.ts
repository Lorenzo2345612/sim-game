import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type BakedSpecies = 'oak' | 'plane' | 'pine';
export type GlbSpecies = 'palm-date' | 'palm-coconut' | 'cactus' | 'shrub-dry';
export type ModelSpecies = BakedSpecies | GlbSpecies;

export interface TreeVariant {
  height: number;
  lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]];
}

/** Baked keys are always loaded; GLB keys only exist once loadGlbModels filled them in. */
export type TreeModels = Record<BakedSpecies, TreeVariant[]> & Partial<Record<GlbSpecies, TreeVariant[]>>;

const BAKED_SPECIES: readonly BakedSpecies[] = ['oak', 'plane', 'pine'];
const GLB_URLS: Record<GlbSpecies, string> = {
  'palm-date': '/models/vegetation/palm-date.glb',
  'palm-coconut': '/models/vegetation/palm-coconut.glb',
  cactus: '/models/props/cactus.glb',
  'shrub-dry': '/models/props/shrub-dry.glb',
};
const VARIANT_COUNT = 4;
// shrub-dry ships as a saturated bush green; tinted dry, it reads as desert scrub.
const DRY_TINT = 0xc4a86a;

export function bakedSpeciesFor(name: string): ModelSpecies {
  if (Object.hasOwn(GLB_URLS, name)) return name as GlbSpecies;
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

function materialOf(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

/** Two perpendicular vertical quads whose union bbox matches `box`, uv 0..1 over each quad. */
function crossedQuads(box: THREE.Box3): THREE.BufferGeometry {
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number): void => {
    const base = positions.length / 3;
    positions.push(ax, box.min.y, az, bx, box.min.y, bz, bx, box.max.y, bz, ax, box.max.y, az);
    for (let i = 0; i < 4; i++) normals.push(nx, 0, nz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(box.min.x, cz, box.max.x, cz, 0, 1);
  quad(cx, box.min.z, cx, box.max.z, 1, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function quadMaterial(source: THREE.Material): THREE.Material {
  const material = source.clone();
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0.5;
  return material;
}

async function loadGlbVariant(loader: GLTFLoader, name: GlbSpecies): Promise<TreeVariant> {
  const gltf = await loader.loadAsync(GLB_URLS[name]);
  const meshes = collectMeshes(gltf.scene);
  if (meshes.length === 0) throw new Error(`No meshes in ${GLB_URLS[name]}`);
  if (name === 'shrub-dry') {
    for (const mesh of meshes) {
      const material = materialOf(mesh);
      if (material instanceof THREE.MeshStandardMaterial) material.color.setHex(DRY_TINT);
    }
  }
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const height = box.max.y - box.min.y;
  const quads = new THREE.Mesh(crossedQuads(box), quadMaterial(materialOf(meshes[0])));
  // LOD2 (>= 250 m) reuses the LOD1 quads; all four variants share the single load.
  const variant: TreeVariant = { height: height > 0 ? height : 1, lods: [meshes, [quads], [quads]] };
  return variant;
}

/** One GLB load per requested species; unknown names are ignored. */
export async function loadGlbModels(names: readonly string[]): Promise<Partial<Record<GlbSpecies, TreeVariant[]>>> {
  const wanted = [...new Set(names)].filter((name): name is GlbSpecies => Object.hasOwn(GLB_URLS, name));
  const loader = new GLTFLoader();
  const out: Partial<Record<GlbSpecies, TreeVariant[]>> = {};
  await Promise.all(
    wanted.map(async (name) => {
      const variant = await loadGlbVariant(loader, name);
      out[name] = Array.from({ length: VARIANT_COUNT }, () => variant);
    }),
  );
  return out;
}

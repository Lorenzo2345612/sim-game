import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO, type Document, type Material, type Texture } from '@gltf-transform/core';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT_DIR = join(ROOT, 'public', 'models', 'trees');
const GENERATOR = 'sim-game buildTrees';
const SEEDS = [11, 12, 13, 14] as const;
const LOD0_MAX_TRIANGLES = 6000;
const LOD1_MAX_TRIANGLES = 1500;
const ALPHA_CUTOFF = 0.5;

export type BakedSpecies = 'oak' | 'plane' | 'pine';

export const SPECIES: Record<
  BakedSpecies,
  { preset: string; leaf: 'leaf-oak' | 'leaf-pine'; bark: 'plane' | 'pine' }
> = {
  oak: { preset: 'Oak Medium', leaf: 'leaf-oak', bark: 'plane' },
  plane: { preset: 'Ash Medium', leaf: 'leaf-oak', bark: 'plane' },
  pine: { preset: 'Pine Large', leaf: 'leaf-pine', bark: 'pine' },
};

const HEIGHT: Record<BakedSpecies, { min: number; max: number; mid: number }> = {
  oak: { min: 12, max: 22, mid: 17 },
  plane: { min: 12, max: 22, mid: 17 },
  pine: { min: 18, max: 30, mid: 24 },
};

// ez-tree loads its textures at module scope through TextureLoader, which needs a DOM.
function installDomStubs(): void {
  const g = globalThis as Record<string, unknown>;
  class StubImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / 4 / width;
    }
  }
  class StubImage {
    width = 1;
    height = 1;
    complete = true;
    addEventListener(): void {}
    removeEventListener(): void {}
    set src(_v: string) {}
  }
  class StubFileReader {
    result: unknown = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob: Blob): void {
      void blob.arrayBuffer().then((buf) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
        this.onloadend?.();
      });
    }
  }
  function makeContext() {
    return {
      fillStyle: '#000',
      translate(): void {},
      scale(): void {},
      fillRect(): void {},
      drawImage(): void {},
      getImageData(_x: number, _y: number, w: number, h: number) {
        return new StubImageData(new Uint8ClampedArray(w * h * 4), w, h);
      },
      putImageData(): void {},
    };
  }
  class StubCanvas {
    width = 0;
    height = 0;
    getContext(): ReturnType<typeof makeContext> {
      return makeContext();
    }
    toBlob(resolve: (b: Blob) => void, type?: string): void {
      resolve(new Blob([new Uint8Array(8)], { type: type ?? 'image/png' }));
    }
  }
  g.document = {
    createElementNS() {
      return new StubImage();
    },
    createElement(name: string) {
      return name === 'canvas' ? new StubCanvas() : new StubImage();
    },
  };
  g.Image = StubImage;
  g.ImageData = StubImageData;
  g.FileReader = StubFileReader;
  g.HTMLCanvasElement = StubCanvas;
}

installDomStubs();

const { Tree, TreePreset } = await import('@dgreenheck/ez-tree');

type Levels = Record<string, number>;

interface TreeJson {
  seed: number;
  branch: {
    levels: number;
    sections: Levels;
    segments: Levels;
    children: Levels;
  };
  leaves: { count: number };
}

interface Geom {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
}

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

function clonePreset(preset: string): TreeJson {
  const source = TreePreset as unknown as Record<string, object>;
  const json = source[preset];
  if (!json) throw new Error(`unknown ez-tree preset ${preset}`);
  return structuredClone(json) as TreeJson;
}

function generateTree(json: TreeJson): { bark: Geom; leaf: Geom } {
  const tree = new Tree();
  (tree as unknown as { loadFromJson(j: object): void }).loadFromJson(json);
  return {
    bark: readGeom((tree as unknown as { branchesMesh: { geometry: BufferGeometry } }).branchesMesh.geometry),
    leaf: readGeom((tree as unknown as { leavesMesh: { geometry: BufferGeometry } }).leavesMesh.geometry),
  };
}

function readGeom(geometry: BufferGeometry): Geom {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  if (!position || !normal || !uv || !index) throw new Error('ez-tree geometry missing attributes');
  const out: Geom = {
    position: Array.from(position.array as Float32Array),
    normal: Array.from(normal.array as Float32Array),
    uv: Array.from(uv.array as Float32Array),
    index: Array.from(index.array as Uint16Array | Uint32Array),
  };
  for (const v of out.position) if (!Number.isFinite(v)) throw new Error('non-finite position');
  for (const v of out.normal) if (!Number.isFinite(v)) throw new Error('non-finite normal');
  return out;
}

function triangleCount(parts: Geom[]): number {
  let triangles = 0;
  for (const g of parts) triangles += g.index.length / 3;
  return triangles;
}

function halveLevels(map: Levels, min: number): boolean {
  let changed = false;
  for (const k of Object.keys(map)) {
    const next = Math.max(min, Math.floor((map[k] as number) / 2));
    if (next !== map[k]) {
      map[k] = next;
      changed = true;
    }
  }
  return changed;
}

/** lod0: halve `leaves.count` first, then branch sections/segments once leaves bottom out. */
function lod0Tree(preset: string, seed: number): { bark: Geom; leaf: Geom } {
  const json = clonePreset(preset);
  json.seed = seed;
  let parts = generateTree(json);
  while (triangleCount([parts.bark, parts.leaf]) > LOD0_MAX_TRIANGLES && json.leaves.count > 1) {
    json.leaves.count = Math.floor(json.leaves.count / 2);
    parts = generateTree(json);
  }
  while (triangleCount([parts.bark, parts.leaf]) > LOD0_MAX_TRIANGLES) {
    const changed = halveLevels(json.branch.sections, 1) || halveLevels(json.branch.segments, 1);
    if (!changed) throw new Error(`lod0 budget unreachable for seed ${seed}`);
    parts = generateTree(json);
  }
  return parts;
}

/** lod1: same preset/seed with sections/segments and leaf count reduced together. */
function lod1Tree(preset: string, seed: number): { bark: Geom; leaf: Geom } {
  const json = clonePreset(preset);
  json.seed = seed;
  let parts = generateTree(json);
  let guard = 0;
  while (triangleCount([parts.bark, parts.leaf]) > LOD1_MAX_TRIANGLES && guard++ < 32) {
    if (json.leaves.count > 0) json.leaves.count = Math.floor(json.leaves.count / 2);
    halveLevels(json.branch.sections, 1);
    halveLevels(json.branch.segments, 1);
    parts = generateTree(json);
  }
  if (triangleCount([parts.bark, parts.leaf]) > LOD1_MAX_TRIANGLES) {
    throw new Error(`lod1 budget unreachable for seed ${seed}`);
  }
  return parts;
}

function geomBounds(g: Geom): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = g.position[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function unionBounds(list: Geom[]): BBox {
  const out: BBox = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const g of list) {
    const b = geomBounds(g);
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < out.min[k]) out.min[k] = b.min[k];
      if (b.max[k] > out.max[k]) out.max[k] = b.max[k];
    }
  }
  return out;
}

function transformGeom(g: Geom, scale: number, dy: number): void {
  for (let i = 0; i < g.position.length; i += 3) {
    g.position[i] *= scale;
    g.position[i + 1] = g.position[i + 1] * scale + dy;
    g.position[i + 2] *= scale;
  }
}

/** Two crossed vertical quads whose union bbox matches `b`. */
function lod2Geom(b: BBox): Geom {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const g: Geom = { position: [], normal: [], uv: [], index: [] };
  const quad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    nx: number, ny: number, nz: number,
  ): void => {
    // Quad spans a→b along one axis and y0→y1 vertically, anchored at (ax, y, az) / (bx, y, bz).
    const base = g.position.length / 3;
    g.position.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let i = 0; i < 4; i++) g.normal.push(nx, ny, nz);
    g.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    g.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(x0, 0, cz, x1, 0, cz, 0, 0, 1);
  quad(cx, 0, z0, cx, 0, z1, 1, 0, 0);
  return g;
}

function toGeometry(g: Geom): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(g.position), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(g.normal), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(g.uv), 2));
  geometry.setIndex(new BufferAttribute(new Uint32Array(g.index), 1));
  return geometry;
}

function stubTexture(name: string): DataTexture {
  const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  texture.name = name;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeMaterials(): { bark: MeshStandardMaterial; leaf: MeshStandardMaterial } {
  return {
    bark: new MeshStandardMaterial({
      name: 'bark',
      map: stubTexture('bark-color'),
      normalMap: stubTexture('bark-normal'),
      roughnessMap: stubTexture('bark-roughness'),
      metalness: 0,
      roughness: 1,
    }),
    leaf: new MeshStandardMaterial({
      name: 'leaf',
      map: stubTexture('leaf-color'),
      normalMap: stubTexture('leaf-normal'),
      alphaMap: stubTexture('leaf-opacity'),
      alphaTest: ALPHA_CUTOFF,
      side: DoubleSide,
      metalness: 0,
      roughness: 1,
    }),
  };
}

const TEXTURE_SLOTS = [
  'bark-color',
  'bark-normal',
  'bark-roughness',
  'leaf-color',
  'leaf-normal',
  'leaf-opacity',
] as const;

type TextureSlot = (typeof TEXTURE_SLOTS)[number];

function textureUri(species: BakedSpecies, slot: TextureSlot): string {
  const { leaf, bark } = SPECIES[species];
  if (slot === 'bark-color') return `../../textures/bark/${bark}/color.jpg`;
  if (slot === 'bark-normal') return `../../textures/bark/${bark}/normal.jpg`;
  if (slot === 'bark-roughness') return `../../textures/bark/${bark}/roughness.jpg`;
  if (slot === 'leaf-color') return `../../textures/foliage/${leaf}/color.jpg`;
  if (slot === 'leaf-normal') return `../../textures/foliage/${leaf}/normal.jpg`;
  return `../../textures/foliage/${leaf}/opacity.jpg`;
}

function bindTexture(texture: Texture | null, slot: TextureSlot): void {
  if (!texture) throw new Error(`missing ${slot} texture`);
  texture.setName(slot);
  texture.setImage(null);
  texture.setMimeType('image/jpeg');
}

function patchMaterials(doc: Document, species: BakedSpecies): Map<string, string> {
  const materials = doc.getRoot().listMaterials();
  const leafMats = materials.filter((m) => m.getAlphaMode() === 'MASK');
  const barkMats = materials.filter((m) => m.getAlphaMode() !== 'MASK');
  if (leafMats.length !== 1 || barkMats.length !== 1) {
    throw new Error(`expected one bark and one leaf material, got ${barkMats.length}/${leafMats.length}`);
  }
  const bark = barkMats[0] as Material;
  const leaf = leafMats[0] as Material;
  bindTexture(bark.getBaseColorTexture(), 'bark-color');
  bindTexture(bark.getNormalTexture(), 'bark-normal');
  bindTexture(bark.getMetallicRoughnessTexture(), 'bark-roughness');
  bindTexture(leaf.getBaseColorTexture(), 'leaf-color');
  bindTexture(leaf.getNormalTexture(), 'leaf-normal');
  // glTF has no alpha-map slot: keep the opacity map as a named texture plus an extras URI.
  bindTexture(doc.createTexture(), 'leaf-opacity');
  leaf.setExtras({ alphaMap: textureUri(species, 'leaf-opacity') });
  leaf.setAlphaMode('MASK');
  leaf.setAlphaCutoff(ALPHA_CUTOFF);
  leaf.setDoubleSided(true);
  return new Map(TEXTURE_SLOTS.map((slot) => [slot, textureUri(species, slot)]));
}

// GLB writers drop URI-only images; names carry the mapping back to the texture files.
function patchGlbImageUris(glb: Buffer, uriOf: Map<string, string>): Buffer {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: { name?: string; uri?: string; bufferView?: number; mimeType?: string }[];
  };
  for (const image of json.images ?? []) {
    const uri = image.name === undefined ? undefined : uriOf.get(image.name);
    if (uri === undefined) throw new Error(`no texture URI for image ${image.name ?? '<unnamed>'}`);
    image.uri = uri;
    delete image.bufferView;
    image.mimeType = 'image/jpeg';
  }
  let chunk = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (chunk.length % 4)) % 4;
  if (pad > 0) chunk = Buffer.concat([chunk, Buffer.alloc(pad, 0x20)]);
  const rest = glb.subarray(20 + jsonLen);
  const total = 12 + 8 + chunk.length + rest.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out;
}

async function exportGlb(scene: Scene): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  return result as ArrayBuffer;
}

function buildLods(species: BakedSpecies, seed: number): Scene {
  const materials = makeMaterials();
  const lod0 = lod0Tree(SPECIES[species].preset, seed);
  const lod1 = lod1Tree(SPECIES[species].preset, seed);

  const raw = unionBounds([lod0.bark, lod0.leaf]);
  const rawHeight = raw.max[1] - raw.min[1];
  if (!(rawHeight > 0)) throw new Error(`degenerate lod0 height for ${species} seed ${seed}`);
  const range = HEIGHT[species];
  const inRange = rawHeight >= range.min && rawHeight <= range.max;
  const scale = inRange ? 1 : range.mid / rawHeight;
  const dy = -raw.min[1] * scale;

  for (const g of [lod0.bark, lod0.leaf, lod1.bark, lod1.leaf]) transformGeom(g, scale, dy);

  const bounds = unionBounds([lod0.bark, lod0.leaf]);
  const lod2 = lod2Geom(bounds);

  const scene = new Scene();
  scene.name = 'tree';
  const addLod = (name: string, bark: Geom | null, leaf: Geom): void => {
    const group = new Group();
    group.name = name;
    if (bark) {
      const mesh = new Mesh(toGeometry(bark), materials.bark);
      mesh.name = 'bark';
      group.add(mesh);
    }
    const leafMesh = new Mesh(toGeometry(leaf), materials.leaf);
    leafMesh.name = 'leaf';
    group.add(leafMesh);
    scene.add(group);
  };
  addLod('lod0', lod0.bark, lod0.leaf);
  addLod('lod1', lod1.bark, lod1.leaf);
  addLod('lod2', null, lod2);
  return scene;
}

async function buildOne(species: BakedSpecies, seed: number, outPath: string): Promise<void> {
  const scene = buildLods(species, seed);
  const glb = await exportGlb(scene);
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(glb));
  const asset = doc.getRoot().getAsset();
  asset.generator = GENERATOR;
  if (asset.extras !== undefined) delete asset.extras;
  const uriOf = patchMaterials(doc, species);
  writeFileSync(outPath, patchGlbImageUris(Buffer.from(await io.writeBinary(doc)), uriOf));
}

export async function buildAll(outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const species of Object.keys(SPECIES) as BakedSpecies[]) {
    for (let variant = 0; variant < SEEDS.length; variant++) {
      const outPath = join(outDir, `${species}-${variant}.glb`);
      await buildOne(species, SEEDS[variant], outPath);
      written.push(outPath);
    }
  }
  return written;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  (async () => {
    const paths = await buildAll(DEFAULT_OUT_DIR);
    console.log(`wrote ${paths.length} tree glbs to public/models/trees`);
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

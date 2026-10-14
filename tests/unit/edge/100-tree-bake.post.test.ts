import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { NodeIO, type Document, type Node, type Primitive } from '@gltf-transform/core';
import { buildAll } from '../../../tools/assets/buildTrees';

const ROOT = join(__dirname, '..', '..', '..');
const OUT_DIR = join(ROOT, 'public', 'models', 'trees');
const GLB_NAMES = ['oak', 'plane', 'pine'].flatMap((s) => [0, 1, 2, 3].map((v) => `${s}-${v}.glb`));
const LEAF_DIR = { oak: 'leaf-oak', plane: 'leaf-oak', pine: 'leaf-pine' } as const;

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tree-bake-post-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

interface GlbJson {
  asset: { generator?: string };
  images: { name?: string; uri?: string; bufferView?: number; mimeType?: string }[];
  scenes: { nodes: number[] }[];
  nodes: { name?: string }[];
}

function glbJson(path: string): GlbJson {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  expect(dv.getUint32(0, true), 'glb magic').toBe(0x46546c67);
  const jsonLen = dv.getUint32(12, true);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

async function readDoc(name: string): Promise<Document> {
  return new NodeIO().read(join(OUT_DIR, name));
}

function topLevelNames(path: string): string[] {
  const json = glbJson(path);
  return json.scenes[0].nodes.map((i) => json.nodes[i].name ?? '');
}

function lodNode(doc: Document, name: string): Node {
  const node = doc.getRoot().listScenes()[0].listChildren().find((n) => n.getName() === name);
  if (!node) throw new Error(`missing node ${name}`);
  return node;
}

function triangles(node: Node): number {
  let tris = 0;
  node.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const positions = prim.getAttribute('POSITION');
      const elements = indices ? indices.getCount() : positions ? positions.getCount() : 0;
      tris += Math.floor(elements / 3);
    }
  });
  return tris;
}

function childMeshNames(node: Node): string[] {
  return node.listChildren().map((n) => n.getName());
}

function speciesOf(name: string): keyof typeof LEAF_DIR {
  return name.split('-')[0] as keyof typeof LEAF_DIR;
}

describe('100 tree bake post-code gaps', () => {
  it('POST1: asset.generator is the fixed sim-game buildTrees string without timestamps', () => {
    for (const name of GLB_NAMES) {
      expect(glbJson(join(OUT_DIR, name)).asset.generator, name).toBe('sim-game buildTrees');
    }
  });

  it('POST2: texture images are external jpeg URIs and never embedded', () => {
    for (const name of GLB_NAMES) {
      const { images } = glbJson(join(OUT_DIR, name));
      expect(images.length, name).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.uri, `${name} ${image.name}`).toMatch(/^\.\.\/\.\.\/textures\//);
        expect(image.bufferView, `${name} ${image.name} embedded`).toBeUndefined();
        expect(image.mimeType, `${name} ${image.name}`).toBe('image/jpeg');
      }
    }
  });

  it('POST3: leaf material exposes the species opacity map as its alpha', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      const leaf = doc.getRoot().listMaterials().find((m) => m.getAlphaMode() === 'MASK');
      expect(leaf, `${name} leaf`).toBeTruthy();
      const uri = (leaf?.getExtras() as { alphaMap?: string } | undefined)?.alphaMap ?? '';
      expect(uri, `${name} alphaMap`).toBe(`../../textures/foliage/${LEAF_DIR[speciesOf(name)]}/opacity.jpg`);
      expect(existsSync(join(OUT_DIR, uri)), `${name} alphaMap file`).toBe(true);
    }
  });

  it('POST4: every image URI is referenced by a material texture slot or the leaf alphaMap', async () => {
    for (const name of GLB_NAMES) {
      const path = join(OUT_DIR, name);
      const doc = await readDoc(name);
      const used = new Set<string>();
      for (const m of doc.getRoot().listMaterials()) {
        for (const tex of [
          m.getBaseColorTexture(),
          m.getNormalTexture(),
          m.getMetallicRoughnessTexture(),
          m.getEmissiveTexture(),
          m.getOcclusionTexture(),
        ]) {
          if (tex) used.add(tex.getURI());
        }
        const extras = m.getExtras() as { alphaMap?: string } | undefined;
        if (extras?.alphaMap) used.add(extras.alphaMap);
      }
      for (const image of glbJson(path).images) {
        expect(used.has(image.uri ?? ''), `${name} unused image ${image.name}`).toBe(true);
      }
    }
  });

  it('POST5: lod0 and lod1 hold bark and leaf meshes, lod2 a single leaf mesh', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      expect(childMeshNames(lodNode(doc, 'lod0')), `${name} lod0 meshes`).toEqual(['bark', 'leaf']);
      expect(childMeshNames(lodNode(doc, 'lod1')), `${name} lod1 meshes`).toEqual(['bark', 'leaf']);
      expect(childMeshNames(lodNode(doc, 'lod2')), `${name} lod2 meshes`).toEqual(['leaf']);
    }
  });

  it('POST6: lod0 and lod1 bark and leaf meshes are non-empty', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      for (const lod of ['lod0', 'lod1']) {
        for (const child of lodNode(doc, lod).listChildren()) {
          expect(triangles(child), `${name} ${lod} ${child.getName()} triangles`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('POST7: lod2 is two crossed vertical quads spanning the full tree height', async () => {
    for (const name of GLB_NAMES) {
      const lod2 = lodNode(await readDoc(name), 'lod2');
      const prims: Primitive[] = [];
      lod2.traverse((n) => {
        const mesh = n.getMesh();
        if (mesh) prims.push(...mesh.listPrimitives());
      });
      expect(prims, `${name} lod2 primitive`).toHaveLength(1);
      const posAttr = prims[0].getAttribute('POSITION');
      const norAttr = prims[0].getAttribute('NORMAL');
      expect(posAttr, `${name} lod2 positions`).toBeTruthy();
      expect(norAttr, `${name} lod2 normals`).toBeTruthy();
      const pos = posAttr!.getArray() as ArrayLike<number>;
      const nor = norAttr!.getArray() as ArrayLike<number>;
      expect(pos.length / 3, `${name} lod2 vertices`).toBe(8);
      const ys = new Set<number>();
      const dirs = new Set<string>();
      for (let i = 0; i < pos.length; i += 3) {
        ys.add(Math.round(pos[i + 1] * 1e3) / 1e3);
        const nx = Math.round(nor[i] * 1e3) / 1e3;
        const ny = Math.round(nor[i + 1] * 1e3) / 1e3;
        const nz = Math.round(nor[i + 2] * 1e3) / 1e3;
        expect(nor[i + 1], `${name} lod2 normal not vertical-face`).toBeCloseTo(0, 3);
        dirs.add(`${nx},${ny},${nz}`);
      }
      expect(ys.size, `${name} lod2 vertical span`).toBe(2);
      expect(dirs.size, `${name} lod2 crossed quads`).toBe(2);
    }
  });

  it('POST8: buildAll creates a missing nested outDir and writes the twelve glbs there', async () => {
    const outDir = join(tmp(), 'nested', 'out');
    const written = await buildAll(outDir);
    expect(written).toHaveLength(12);
    for (const name of GLB_NAMES) {
      expect(existsSync(join(outDir, name)), name).toBe(true);
    }
    expect(topLevelNames(join(outDir, 'oak-0.glb'))).toEqual(['lod0', 'lod1', 'lod2']);
  }, 600000);

  it('POST9: buildAll overwrites existing non-glb files without prompting', async () => {
    const outDir = tmp();
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'pine-2.glb'), 'not a glb at all');
    await buildAll(outDir);
    const buf = readFileSync(join(outDir, 'pine-2.glb'));
    expect(buf.readUInt32LE(0), 'glb magic').toBe(0x46546c67);
    expect(topLevelNames(join(outDir, 'pine-2.glb'))).toEqual(['lod0', 'lod1', 'lod2']);
  }, 600000);

  it('POST10: buildAll completes without any network access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('network forbidden'))) as typeof fetch;
    try {
      const written = await buildAll(join(tmp(), 'offline'));
      expect(written).toHaveLength(12);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 600000);
});

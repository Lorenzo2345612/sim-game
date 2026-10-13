import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds, type Document, type Material, type Node } from '@gltf-transform/core';
import { buildAll } from '../../../tools/assets/buildTrees';

const OUT_DIR = join(__dirname, '..', '..', '..', 'public', 'models', 'trees');
const SPECIES_NAMES = ['oak', 'plane', 'pine'] as const;
const VARIANTS = [0, 1, 2, 3];
const GLB_NAMES = SPECIES_NAMES.flatMap((s) => VARIANTS.map((v) => `${s}-${v}.glb`));
const HEIGHT_RANGE: Record<string, [number, number]> = {
  oak: [12, 22],
  plane: [12, 22],
  pine: [18, 30],
};
const LOD_NODE_NAMES = ['lod0', 'lod1', 'lod2'] as const;
const MAX_TRIANGLES = { lod0: 6000, lod1: 1500, lod2: 64 } as const;
const BBOX_TOL = 0.1;
const ALPHA_CUTOFF = 0.5;

function glbPath(name: string): string {
  return join(OUT_DIR, name);
}

async function readDoc(name: string): Promise<Document> {
  return new NodeIO().read(glbPath(name));
}

function topNames(doc: Document): string[] {
  return doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .map((n) => n.getName())
    .sort();
}

function lodNode(doc: Document, name: string): Node {
  const node = doc.getRoot().listScenes()[0].listChildren().find((n) => n.getName() === name);
  if (!node) throw new Error(`missing node ${name}`);
  return node;
}

function triangleCount(node: Node): number {
  let triangles = 0;
  node.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const positions = prim.getAttribute('POSITION');
      const elements = indices ? indices.getCount() : positions ? positions.getCount() : 0;
      triangles += Math.floor(elements / 3);
    }
  });
  return triangles;
}

function extent(b: { min: readonly number[]; max: readonly number[] }, axis: number): number {
  return b.max[axis] - b.min[axis];
}

function hasAnyTexture(m: Material): boolean {
  return (
    m.getBaseColorTexture() !== null ||
    m.getNormalTexture() !== null ||
    m.getMetallicRoughnessTexture() !== null ||
    m.getEmissiveTexture() !== null ||
    m.getOcclusionTexture() !== null
  );
}

describe('100 tree bake acceptance', () => {
  beforeAll(async () => {
    if (GLB_NAMES.some((n) => !existsSync(glbPath(n)))) await buildAll(OUT_DIR);
  }, 600000);

  it('AT1: buildAll writes twelve tree glbs under public/models/trees', async () => {
    await buildAll(OUT_DIR);
    for (const name of GLB_NAMES) {
      expect(existsSync(glbPath(name)), name).toBe(true);
    }
  }, 600000);

  it('AT2: each glb has lod0, lod1 and lod2 within triangle limits and lod2 matches lod0 bounds', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      expect(topNames(doc), name).toEqual([...LOD_NODE_NAMES]);
      const lod0 = lodNode(doc, 'lod0');
      const lod1 = lodNode(doc, 'lod1');
      const lod2 = lodNode(doc, 'lod2');
      expect(triangleCount(lod0), `${name} lod0 triangles`).toBeLessThanOrEqual(MAX_TRIANGLES.lod0);
      expect(triangleCount(lod1), `${name} lod1 triangles`).toBeLessThanOrEqual(MAX_TRIANGLES.lod1);
      expect(triangleCount(lod2), `${name} lod2 triangles`).toBeLessThanOrEqual(MAX_TRIANGLES.lod2);
      const b0 = getBounds(lod0);
      const b2 = getBounds(lod2);
      for (let axis = 0; axis < 3; axis++) {
        const e0 = extent(b0, axis);
        const e2 = extent(b2, axis);
        expect(Math.abs(e2 - e0) / e0, `${name} lod2 bbox axis ${axis}`).toBeLessThanOrEqual(BBOX_TOL);
      }
    }
  });

  it('AT3: each glb has textured bark and leaf materials with alpha-tested leaves', async () => {
    for (const name of GLB_NAMES) {
      const materials = (await readDoc(name)).getRoot().listMaterials();
      const leaves = materials.filter((m) => m.getAlphaMode() === 'MASK');
      const barks = materials.filter((m) => m.getAlphaMode() !== 'MASK');
      expect(leaves.length, `${name} leaf material`).toBeGreaterThan(0);
      expect(barks.length, `${name} bark material`).toBeGreaterThan(0);
      for (const m of leaves) {
        expect(m.getBaseColorTexture(), `${name} leaf color map`).not.toBeNull();
        expect(m.getAlphaCutoff(), `${name} alphaTest`).toBeCloseTo(ALPHA_CUTOFF, 5);
        expect(m.getDoubleSided(), `${name} leaf double-sided`).toBe(true);
      }
      for (const m of barks) {
        expect(m.getBaseColorTexture(), `${name} bark color map`).not.toBeNull();
        expect(m.getNormalTexture(), `${name} bark normal map`).not.toBeNull();
      }
      for (const m of materials) {
        expect(hasAnyTexture(m), `${name} untextured material`).toBe(true);
      }
    }
  });

  it('AT4: pine glbs are 18-30 m tall and oak and plane glbs are 12-22 m tall', async () => {
    for (const name of GLB_NAMES) {
      const species = name.split('-')[0];
      const [lo, hi] = HEIGHT_RANGE[species];
      const height = extent(getBounds(lodNode(await readDoc(name), 'lod0')), 1);
      expect(height, `${name} height`).toBeGreaterThanOrEqual(lo);
      expect(height, `${name} height`).toBeLessThanOrEqual(hi);
    }
  });

  it('AT5: running buildAll twice produces byte-identical files', async () => {
    await buildAll(OUT_DIR);
    const first = GLB_NAMES.map((n) => readFileSync(glbPath(n)));
    await buildAll(OUT_DIR);
    const second = GLB_NAMES.map((n) => readFileSync(glbPath(n)));
    for (let i = 0; i < GLB_NAMES.length; i++) {
      expect(second[i].equals(first[i]), GLB_NAMES[i]).toBe(true);
    }
  }, 600000);
});

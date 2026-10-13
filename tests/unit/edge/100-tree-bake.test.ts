import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds, type Document, type Material, type Node } from '@gltf-transform/core';
import { buildAll, SPECIES } from '../../../tools/assets/buildTrees';

const ROOT = join(__dirname, '..', '..', '..');
const OUT_DIR = join(ROOT, 'public', 'models', 'trees');
const SPECIES_NAMES = ['oak', 'plane', 'pine'] as const;
const VARIANTS = [0, 1, 2, 3];
const GLB_NAMES = SPECIES_NAMES.flatMap((s) => VARIANTS.map((v) => `${s}-${v}.glb`));
const SPECIES_SPEC = {
  oak: { preset: 'Oak Medium', leaf: 'leaf-oak', bark: 'plane' },
  plane: { preset: 'Ash Medium', leaf: 'leaf-oak', bark: 'plane' },
  pine: { preset: 'Pine Large', leaf: 'leaf-pine', bark: 'pine' },
} as const;
const TEXTURE_DIR = {
  oak: { leaf: 'foliage/leaf-oak', bark: 'bark/plane' },
  plane: { leaf: 'foliage/leaf-oak', bark: 'bark/plane' },
  pine: { leaf: 'foliage/leaf-pine', bark: 'bark/pine' },
} as const;
const TEXTURE_URI = /^\.\.\/\.\.\/textures\/(foliage\/leaf-(oak|pine)|bark\/(plane|pine))\/(color|normal|roughness|opacity)\.jpg$/;

let written: string[] = [];
const docs = new Map<string, Document>();

async function readDoc(name: string): Promise<Document> {
  const cached = docs.get(name);
  if (cached) return cached;
  const doc = await new NodeIO().read(join(OUT_DIR, name));
  docs.set(name, doc);
  return doc;
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

function materialsOf(node: Node): Material[] {
  const out: Material[] = [];
  node.traverse((n) => {
    const mesh = n.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (material) out.push(material);
    }
  });
  return out;
}

function meshCount(node: Node): number {
  let count = 0;
  node.traverse((n) => {
    if (n.getMesh()) count += 1;
  });
  return count;
}

function speciesOf(name: string): keyof typeof TEXTURE_DIR {
  return name.split('-')[0] as keyof typeof TEXTURE_DIR;
}

describe('100 tree bake edges', () => {
  beforeAll(async () => {
    written = await buildAll(OUT_DIR);
  }, 600000);

  it('EDGE1: buildAll returns the twelve written glb paths under outDir', () => {
    expect(written).toHaveLength(12);
    expect(written.map((p) => basename(p)).sort()).toEqual([...GLB_NAMES].sort());
    for (const p of written) {
      expect(resolve(p), p).toBe(join(OUT_DIR, basename(p)));
      expect(existsSync(p), p).toBe(true);
    }
  });

  it('EDGE2: glbs that differ by seed or by species preset are byte-distinct', () => {
    const bytes = (n: string) => readFileSync(join(OUT_DIR, n));
    for (const s of SPECIES_NAMES) {
      for (const i of VARIANTS) {
        for (const j of VARIANTS) {
          if (i < j) {
            expect(bytes(`${s}-${i}.glb`).equals(bytes(`${s}-${j}.glb`)), `${s}-${i} vs ${s}-${j}`).toBe(false);
          }
        }
      }
    }
    for (const v of VARIANTS) {
      expect(bytes(`oak-${v}.glb`).equals(bytes(`plane-${v}.glb`)), `oak-${v} vs plane-${v}`).toBe(false);
    }
  });

  it('EDGE3: SPECIES maps each species to its ez-tree preset and texture names', () => {
    expect(SPECIES.oak).toEqual(SPECIES_SPEC.oak);
    expect(SPECIES.plane).toEqual(SPECIES_SPEC.plane);
    expect(SPECIES.pine).toEqual(SPECIES_SPEC.pine);
  });

  it('EDGE4: textures are external relative URIs to the species texture files', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      const { leaf, bark } = TEXTURE_DIR[speciesOf(name)];
      for (const texture of doc.getRoot().listTextures()) {
        const uri = texture.getURI();
        expect(uri, `${name} ${uri}`).toMatch(TEXTURE_URI);
        expect(existsSync(resolve(OUT_DIR, uri)), `${name} ${uri}`).toBe(true);
      }
      for (const material of doc.getRoot().listMaterials()) {
        const dir = material.getAlphaMode() === 'MASK' ? leaf : bark;
        expect(material.getBaseColorTexture()?.getURI() ?? '', `${name} ${material.getName()} color`).toBe(
          `../../textures/${dir}/color.jpg`,
        );
        if (material.getAlphaMode() !== 'MASK') {
          expect(material.getNormalTexture()?.getURI() ?? '', `${name} ${material.getName()} normal`).toBe(
            `../../textures/${dir}/normal.jpg`,
          );
        }
      }
    }
  });

  it('EDGE5: leaf materials have a normal map and bark materials a roughness map', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      const { leaf, bark } = TEXTURE_DIR[speciesOf(name)];
      for (const material of doc.getRoot().listMaterials()) {
        if (material.getAlphaMode() === 'MASK') {
          expect(material.getNormalTexture(), `${name} leaf normal`).not.toBeNull();
          expect(material.getNormalTexture()?.getURI() ?? '', `${name} leaf normal uri`).toBe(
            `../../textures/${leaf}/normal.jpg`,
          );
        } else {
          expect(material.getMetallicRoughnessTexture(), `${name} bark roughness`).not.toBeNull();
          expect(material.getMetallicRoughnessTexture()?.getURI() ?? '', `${name} bark roughness uri`).toBe(
            `../../textures/${bark}/roughness.jpg`,
          );
        }
      }
    }
  });

  it('EDGE6: lod0 and lod1 hold bark and leaf meshes, lod2 a single leaf-only mesh', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      for (const lod of ['lod0', 'lod1']) {
        const modes = materialsOf(lodNode(doc, lod)).map((m) => m.getAlphaMode());
        expect(modes.filter((x) => x === 'MASK').length, `${name} ${lod} leaf meshes`).toBeGreaterThan(0);
        expect(modes.filter((x) => x !== 'MASK').length, `${name} ${lod} bark meshes`).toBeGreaterThan(0);
      }
      const lod2 = lodNode(doc, 'lod2');
      expect(meshCount(lod2), `${name} lod2 meshes`).toBe(1);
      for (const material of materialsOf(lod2)) {
        expect(material.getAlphaMode(), `${name} lod2 material`).toBe('MASK');
      }
    }
  });

  it('EDGE7: lod2 is two crossed quads (4 triangles)', async () => {
    for (const name of GLB_NAMES) {
      expect(triangleCount(lodNode(await readDoc(name), 'lod2')), `${name} lod2 triangles`).toBe(4);
    }
  });

  it('EDGE8: every lod has its trunk base at y = 0', async () => {
    for (const name of GLB_NAMES) {
      const doc = await readDoc(name);
      for (const lod of ['lod0', 'lod1', 'lod2']) {
        expect(getBounds(lodNode(doc, lod)).min[1], `${name} ${lod} base`).toBeCloseTo(0, 3);
      }
    }
  });

  it('EDGE9: package.json exposes build:trees as tsx tools/assets/buildTrees.ts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:trees']).toBe('tsx tools/assets/buildTrees.ts');
  });

  it('EDGE10: ASSETS_LICENSES.md has a generated tree models row citing EZ-Tree under MIT', () => {
    const text = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    const rows = text.split('\n').filter((l) => l.startsWith('|') && /trees/i.test(l) && /ez-tree/i.test(l));
    expect(rows.length, 'missing generated tree models row').toBeGreaterThan(0);
    expect(rows.some((l) => /\bMIT\b/.test(l)), 'row must cite MIT').toBe(true);
  });
});

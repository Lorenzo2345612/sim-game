import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import type { Document, Node as GltfNode, Primitive } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');

const IN_SCOPE_IDS = ['lmp2-a', 'hyper-a'];
const LEGACY_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d'];
const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const SOURCES = [
  'assets/vendor/cars/katattak-ka01/katattak_ka01_lmp2_prototype_full.glb',
  'assets/vendor/cars/cadillac-v-series-r/2023_-_2026_cadillac_v-series.r_lmdh_hypercar.glb',
];

function glbPath(id: string): string {
  return join(MODELS, `${id}.glb`);
}

async function readDoc(id: string): Promise<Document> {
  return new NodeIO().read(glbPath(id));
}

function sceneNodes(doc: Document): Map<string, GltfNode> {
  const out = new Map<string, GltfNode>();
  for (const node of doc.getRoot().listScenes()[0].listChildren()) out.set(node.getName(), node);
  return out;
}

function listPrims(doc: Document): { node: string; prim: Primitive }[] {
  const out: { node: string; prim: Primitive }[] = [];
  for (const [name, node] of sceneNodes(doc)) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) out.push({ node: name, prim });
  }
  return out;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('112 output invariants post checks', () => {
  it('POST25: prototype root nodes are childless and rigid, with the body at the origin', async () => {
    for (const id of IN_SCOPE_IDS) {
      const doc = await readDoc(id);
      const nodes = sceneNodes(doc);
      expect([...nodes.keys()].sort(), id).toEqual(['body', ...WHEEL_NODE_NAMES].sort());
      for (const name of ['body', ...WHEEL_NODE_NAMES]) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name} in ${id}`);
        expect(node.listChildren(), `${id} ${name}`).toHaveLength(0);
        expect(node.getScale(), `${id} ${name} scale`).toEqual([1, 1, 1]);
        expect(node.getRotation(), `${id} ${name} rotation`).toEqual([0, 0, 0, 1]);
      }
      const body = nodes.get('body') as GltfNode;
      expect(body.getTranslation(), id).toEqual([0, 0, 0]);
    }
  });

  it('POST26: prototype primitives are triangles with clean POSITION/NORMAL/index data', async () => {
    for (const id of IN_SCOPE_IDS) {
      const doc = await readDoc(id);
      const prims = listPrims(doc);
      expect(prims.length, id).toBeGreaterThan(0);
      for (const { node, prim } of prims) {
        const where = `${id} ${node}`;
        expect(prim.getMode(), where).toBe(4);
        expect(prim.listSemantics().sort(), where).toEqual(['NORMAL', 'POSITION']);
        expect(prim.getIndices(), where).toBeTruthy();
        const pos = prim.getAttribute('POSITION');
        const nrm = prim.getAttribute('NORMAL');
        const idx = prim.getIndices();
        if (!pos || !nrm || !idx) throw new Error(`incomplete primitive in ${where}`);
        expect(idx.getCount() % 3, where).toBe(0);
        const ia = idx.getArray() as Uint16Array | Uint32Array;
        for (let i = 0; i < ia.length; i++) {
          expect(ia[i], `${where} index ${i}`).toBeLessThan(pos.getCount());
        }
        for (const arr of [pos.getArray(), nrm.getArray()] as Float32Array[]) {
          for (let i = 0; i < arr.length; i++) {
            expect(Number.isFinite(arr[i]), `${where} value ${i}`).toBe(true);
          }
        }
        const na = nrm.getArray() as Float32Array;
        for (let i = 0; i < na.length; i += 3) {
          const len = Math.hypot(na[i], na[i + 1], na[i + 2]);
          if (len < 1e-6) continue;
          expect(Math.abs(len - 1), `${where} normal ${i}`).toBeLessThanOrEqual(0.01);
        }
      }
    }
  }, 300000);

  it('POST27: untextured prototype outputs carry no textures, TEXCOORD_0 or livery material', async () => {
    for (const id of IN_SCOPE_IDS) {
      const doc = await readDoc(id);
      expect(doc.getRoot().listTextures(), id).toHaveLength(0);
      const names = doc.getRoot().listMaterials().map((m) => m.getName());
      expect(names, id).not.toContain('livery');
      for (const { node, prim } of listPrims(doc)) {
        expect(prim.getAttribute('TEXCOORD_0'), `${id} ${node}`).toBeNull();
      }
    }
  });

  it('POST28: building hyper-a leaves every other output and both sources byte-identical', async () => {
    const tracked = [
      ...LEGACY_IDS.flatMap((id) => [glbPath(id), join(MODELS, `${id}.json`)]),
      glbPath('lmp2-a'),
      join(MODELS, 'lmp2-a.json'),
      ...SOURCES.map((s) => join(ROOT, s)),
    ];
    const before = tracked.map((path) => ({ path, hash: sha256(path) }));
    await buildCar('hyper-a');
    for (const { path, hash } of before) {
      expect(sha256(path), path).toBe(hash);
    }
  }, 600000);
});

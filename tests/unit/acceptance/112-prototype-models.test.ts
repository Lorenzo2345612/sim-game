import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document, Node as GltfNode } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const NEW_CARS = [
  { id: 'lmp2-a', targetLength: 4.745 },
  { id: 'lmp2-b', targetLength: 4.745 },
  { id: 'hyper-a', targetLength: 5.1 },
  { id: 'hyper-b', targetLength: 4.995 },
];

const NEW_IDS = NEW_CARS.map((car) => car.id);
const LEGACY_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d'];
const TRI_BUDGET = 70000;
const BRANDS = [
  'mclaren',
  'porsche',
  'porche',
  'audi',
  'tatuus',
  'lamborghini',
  'ligier',
  'cadillac',
  'ferrari',
  'oreca',
  'katattak',
];

interface CarMeta {
  wheelRadius: number;
  wheelbase: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

const LEGACY_BEFORE = LEGACY_IDS.map((id) => ({
  id,
  glb: readFileSync(join(MODELS, `${id}.glb`)),
  json: readFileSync(join(MODELS, `${id}.json`)),
}));

function glbPath(id: string): string {
  return join(MODELS, `${id}.glb`);
}

function metaPath(id: string): string {
  return join(MODELS, `${id}.json`);
}

function readMeta(id: string): CarMeta {
  return JSON.parse(readFileSync(metaPath(id), 'utf8')) as CarMeta;
}

async function readDoc(id: string): Promise<Document> {
  return new NodeIO().read(glbPath(id));
}

function rootNames(doc: Document): string[] {
  return doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .map((n) => n.getName())
    .sort();
}

function findNode(doc: Document, name: string): GltfNode {
  const node = doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .find((n) => n.getName() === name);
  if (!node) throw new Error(`missing node ${name}`);
  return node;
}

function triangleCount(doc: Document): number {
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const positions = prim.getAttribute('POSITION');
      const elements = indices ? indices.getCount() : positions ? positions.getCount() : 0;
      triangles += Math.floor(elements / 3);
    }
  }
  return triangles;
}

function localBounds(node: GltfNode): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const stack: GltfNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const pMin = pos.getMin([]);
        const pMax = pos.getMax([]);
        for (let i = 0; i < 3; i++) {
          if (pMin[i] < min[i]) min[i] = pMin[i];
          if (pMax[i] > max[i]) max[i] = pMax[i];
        }
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return { min, max };
}

function vertexCount(node: GltfNode): number {
  let count = 0;
  const stack: GltfNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const positions = prim.getAttribute('POSITION');
        if (positions) count += positions.getCount();
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return count;
}

function wheelByName(meta: CarMeta, name: string): { name: string; x: number; y: number; z: number } {
  const wheel = meta.wheels.find((w) => w.name === name);
  if (!wheel) throw new Error(`missing wheel ${name}`);
  return wheel;
}

describe('112 prototype models acceptance', () => {
  beforeAll(() => {
    execSync('npm run build:cars', { cwd: ROOT, stdio: 'pipe', timeout: 1200000 });
  }, 1200000);

  it('AT1: build:cars writes the four prototype models and keeps the f4/gt3 outputs byte-identical', () => {
    for (const id of NEW_IDS) {
      expect(existsSync(glbPath(id)), `${id}.glb`).toBe(true);
      expect(existsSync(metaPath(id)), `${id}.json`).toBe(true);
    }
    for (const { id, glb, json } of LEGACY_BEFORE) {
      expect(readFileSync(glbPath(id)).equals(glb), `${id} glb`).toBe(true);
      expect(readFileSync(metaPath(id)).equals(json), `${id} json`).toBe(true);
    }
  });

  it('AT2: each prototype glb has body and the four wheel nodes and at most 70000 triangles', async () => {
    for (const { id } of NEW_CARS) {
      const doc = await readDoc(id);
      expect(rootNames(doc), id).toEqual(['body', ...WHEEL_NODE_NAMES].sort());
      expect(triangleCount(doc), id).toBeLessThanOrEqual(TRI_BUDGET);
    }
  });

  it('AT3: each prototype matches its target length and the width, height, wheelbase and wheel radius ranges', async () => {
    for (const { id, targetLength } of NEW_CARS) {
      const doc = await readDoc(id);
      const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
      expect(Math.abs(max[2] - min[2] - targetLength), id).toBeLessThanOrEqual(0.05);
      const width = max[0] - min[0];
      const height = max[1] - min[1];
      expect(width, id).toBeGreaterThanOrEqual(1.85);
      expect(width, id).toBeLessThanOrEqual(2.15);
      expect(height, id).toBeGreaterThanOrEqual(0.95);
      expect(height, id).toBeLessThanOrEqual(1.25);
      const meta = readMeta(id);
      expect(meta.wheelbase, id).toBeGreaterThanOrEqual(2.85);
      expect(meta.wheelbase, id).toBeLessThanOrEqual(3.3);
      expect(meta.wheelRadius, id).toBeGreaterThanOrEqual(0.32);
      expect(meta.wheelRadius, id).toBeLessThanOrEqual(0.38);
    }
  });

  it('AT4: each prototype wheel hub sits in its quadrant, on its pivot and with balanced left/right x', async () => {
    for (const { id } of NEW_CARS) {
      const doc = await readDoc(id);
      const meta = readMeta(id);
      expect(wheelByName(meta, 'wheel-front-left').z, id).toBeLessThan(0);
      expect(wheelByName(meta, 'wheel-front-right').z, id).toBeLessThan(0);
      expect(wheelByName(meta, 'wheel-front-left').x, id).toBeLessThan(0);
      expect(wheelByName(meta, 'wheel-back-left').x, id).toBeLessThan(0);
      expect(Math.abs(Math.abs(wheelByName(meta, 'wheel-front-left').x) - Math.abs(wheelByName(meta, 'wheel-front-right').x)), id).toBeLessThanOrEqual(0.02);
      expect(Math.abs(Math.abs(wheelByName(meta, 'wheel-back-left').x) - Math.abs(wheelByName(meta, 'wheel-back-right').x)), id).toBeLessThanOrEqual(0.02);
      for (const name of WHEEL_NODE_NAMES) {
        const { min, max } = localBounds(findNode(doc, name));
        expect(Math.abs((min[0] + max[0]) / 2), `${id} ${name}`).toBeLessThanOrEqual(0.02);
        expect(Math.abs((min[1] + max[1]) / 2), `${id} ${name}`).toBeLessThanOrEqual(0.02);
        expect(Math.abs((min[2] + max[2]) / 2), `${id} ${name}`).toBeLessThanOrEqual(0.02);
      }
      const counts = WHEEL_NODE_NAMES.map((name) => vertexCount(findNode(doc, name)));
      const total = counts.reduce((sum, count) => sum + count, 0);
      for (const count of counts) {
        expect(count / total, id).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('AT5: each prototype output sits at or above the ground and holds no brand strings', async () => {
    for (const { id } of NEW_CARS) {
      const doc = await readDoc(id);
      const { min } = getBounds(doc.getRoot().listScenes()[0]);
      expect(min[1], id).toBeGreaterThanOrEqual(-0.02);
      const glb = readFileSync(glbPath(id)).toString('latin1').toLowerCase();
      const json = readFileSync(metaPath(id), 'utf8').toLowerCase();
      for (const brand of BRANDS) {
        expect(glb, `${id} glb ${brand}`).not.toContain(brand);
        expect(json, `${id} json ${brand}`).not.toContain(brand);
      }
    }
  });
});

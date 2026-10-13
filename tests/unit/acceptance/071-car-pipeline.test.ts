import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document, Node as GltfNode } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const MODELS = join(__dirname, '..', '..', '..', 'public', 'models');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

type WheelName = (typeof WHEEL_NODE_NAMES)[number];

const ALL_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c'];

const GT3 = [
  { id: 'gt3-a', targetLength: 4.64, triBudget: 60000 },
  { id: 'gt3-b', targetLength: 4.6, triBudget: 70000 },
  { id: 'gt3-c', targetLength: 4.58, triBudget: 25000 },
];

const BRANDS = ['mclaren', 'porsche', 'porche', 'audi', 'tatuus', 'lamborghini'];

const F4_REF = {
  triangles: 64851,
  wheelRadius: 0.273059,
  wheelbase: 2.733088,
  trackFront: 1.47159,
  trackRear: 1.486299,
  wheels: {
    'wheel-front-left': { x: -0.735795, y: 0.273182, z: -1.366602 },
    'wheel-front-right': { x: 0.735795, y: 0.273084, z: -1.366503 },
    'wheel-back-left': { x: -0.74315, y: 0.273149, z: 1.366487 },
    'wheel-back-right': { x: 0.74315, y: 0.273215, z: 1.366618 },
  },
};

interface CarMeta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

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

function wheelByName(meta: CarMeta, name: WheelName): { name: string; x: number; y: number; z: number } {
  const wheel = meta.wheels.find((w) => w.name === name);
  if (!wheel) throw new Error(`missing wheel ${name}`);
  return wheel;
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

describe('071 car pipeline acceptance', () => {
  beforeAll(async () => {
    for (const id of ALL_IDS) {
      await buildCar(id);
    }
  }, 300000);

  it('AT1: f4 output matches the outputs committed by task 053', async () => {
    const doc = await readDoc('f4');
    expect(rootNames(doc)).toEqual(['body', ...WHEEL_NODE_NAMES].sort());

    const triangles = triangleCount(doc);
    expect(Math.abs(triangles - F4_REF.triangles)).toBeLessThanOrEqual(0.01 * F4_REF.triangles);

    const meta = readMeta('f4');
    expect(Math.abs(meta.wheelRadius - F4_REF.wheelRadius)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(meta.wheelbase - F4_REF.wheelbase)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(meta.trackFront - F4_REF.trackFront)).toBeLessThanOrEqual(0.005);
    expect(Math.abs(meta.trackRear - F4_REF.trackRear)).toBeLessThanOrEqual(0.005);
    for (const name of WHEEL_NODE_NAMES) {
      const wheel = wheelByName(meta, name);
      const ref = F4_REF.wheels[name];
      expect(Math.abs(wheel.x - ref.x), name).toBeLessThanOrEqual(0.005);
      expect(Math.abs(wheel.y - ref.y), name).toBeLessThanOrEqual(0.005);
      expect(Math.abs(wheel.z - ref.z), name).toBeLessThanOrEqual(0.005);
    }
  });

  it('AT2: gt3 root nodes are body and the four wheels within the triangle budgets', async () => {
    for (const { id, triBudget } of GT3) {
      const doc = await readDoc(id);
      expect(rootNames(doc), id).toEqual(['body', ...WHEEL_NODE_NAMES].sort());
      expect(triangleCount(doc), id).toBeLessThanOrEqual(triBudget);
    }
  });

  it('AT3: gt3 output dimensions match target length and the width, height, wheelbase and wheel radius ranges', async () => {
    for (const { id, targetLength } of GT3) {
      const doc = await readDoc(id);
      const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
      expect(Math.abs(max[2] - min[2] - targetLength), id).toBeLessThanOrEqual(0.05);
      const width = max[0] - min[0];
      const height = max[1] - min[1];
      expect(width, id).toBeGreaterThanOrEqual(1.85);
      expect(width, id).toBeLessThanOrEqual(2.15);
      expect(height, id).toBeGreaterThanOrEqual(1.05);
      expect(height, id).toBeLessThanOrEqual(1.35);
      const meta = readMeta(id);
      expect(meta.wheelbase, id).toBeGreaterThanOrEqual(2.55);
      expect(meta.wheelbase, id).toBeLessThanOrEqual(2.85);
      expect(meta.wheelRadius, id).toBeGreaterThanOrEqual(0.3);
      expect(meta.wheelRadius, id).toBeLessThanOrEqual(0.37);
    }
  });

  it('AT4: gt3 wheel hubs sit in the correct quadrants and are centred on their pivots', async () => {
    for (const { id } of GT3) {
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
        expect(Math.abs((min[0] + max[0]) / 2), name).toBeLessThanOrEqual(0.02);
        expect(Math.abs((min[1] + max[1]) / 2), name).toBeLessThanOrEqual(0.02);
        expect(Math.abs((min[2] + max[2]) / 2), name).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it('AT5: gt3 models have all vertices at or above the ground plane', async () => {
    for (const { id } of GT3) {
      const doc = await readDoc(id);
      const { min } = getBounds(doc.getRoot().listScenes()[0]);
      expect(min[1], id).toBeGreaterThanOrEqual(-0.02);
    }
  });

  it('AT6: gt3 glb and json bytes contain no source brand strings', () => {
    for (const { id } of GT3) {
      const glb = readFileSync(glbPath(id)).toString('latin1').toLowerCase();
      const json = readFileSync(metaPath(id), 'utf8').toLowerCase();
      for (const brand of BRANDS) {
        expect(glb, `${id} glb ${brand}`).not.toContain(brand);
        expect(json, `${id} json ${brand}`).not.toContain(brand);
      }
    }
  });

  it('AT7: every gt3 wheel holds vertices and no wheel holds more than 40 % of them', async () => {
    for (const { id } of GT3) {
      const doc = await readDoc(id);
      const counts = WHEEL_NODE_NAMES.map((name) => vertexCount(findNode(doc, name)));
      const total = counts.reduce((sum, count) => sum + count, 0);
      for (const count of counts) {
        expect(count, id).toBeGreaterThan(0);
        expect(count / total, id).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('AT8: running the build twice produces byte-identical outputs', async () => {
    for (const id of ALL_IDS) {
      await buildCar(id);
      const glb1 = readFileSync(glbPath(id));
      const json1 = readFileSync(metaPath(id), 'utf8');
      await buildCar(id);
      const glb2 = readFileSync(glbPath(id));
      const json2 = readFileSync(metaPath(id), 'utf8');
      expect(glb2.equals(glb1), `${id} glb`).toBe(true);
      expect(json2, `${id} json`).toBe(json1);
    }
  }, 600000);
});

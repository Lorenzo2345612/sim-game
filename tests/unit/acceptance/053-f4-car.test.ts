import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Node as GltfNode } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const GLB_PATH = join(ROOT, 'public', 'models', 'f4.glb');
const JSON_PATH = join(ROOT, 'public', 'models', 'f4.json');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
];

interface F4Meta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

function readMeta(): F4Meta {
  return JSON.parse(readFileSync(JSON_PATH, 'utf8')) as F4Meta;
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

describe('053 F4 car model acceptance', () => {
  it('AT1: scene root children are body and the four wheels, triangles ≤ 80000', async () => {
    const doc = await new NodeIO().read(GLB_PATH);
    const root = doc.getRoot();
    const names = root.listScenes()[0].listChildren().map((n) => n.getName()).sort();
    expect(names).toEqual(['body', ...WHEEL_NODE_NAMES].sort());

    let triangles = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const positions = prim.getAttribute('POSITION');
        const elements = indices ? indices.getCount() : positions ? positions.getCount() : 0;
        triangles += Math.floor(elements / 3);
      }
    }
    expect(triangles).toBeLessThanOrEqual(80000);
  });

  it('AT2: f4.glb and f4.json contain no "tatuus"', () => {
    const glb = readFileSync(GLB_PATH).toString('latin1').toLowerCase();
    const json = readFileSync(JSON_PATH, 'utf8').toLowerCase();
    expect(glb).not.toContain('tatuus');
    expect(json).not.toContain('tatuus');
  });

  it('AT3: f4.json dimensions match wheelbase, track and wheel radius tolerances', () => {
    const meta = readMeta();
    expect(Math.abs(meta.wheelbase - 2.72)).toBeLessThanOrEqual(0.05);
    expect(meta.trackFront).toBeGreaterThanOrEqual(1.35);
    expect(meta.trackFront).toBeLessThanOrEqual(1.65);
    expect(meta.trackRear).toBeGreaterThanOrEqual(1.35);
    expect(meta.trackRear).toBeLessThanOrEqual(1.65);
    expect(Math.abs(meta.wheelRadius - 0.27)).toBeLessThanOrEqual(0.02);

    const byName = new Map(meta.wheels.map((w) => [w.name, w]));
    const wheel = (name: string) => {
      const w = byName.get(name);
      if (!w) throw new Error(`missing wheel ${name}`);
      return w;
    };
    expect(wheel('wheel-front-left').z).toBeLessThan(0);
    expect(wheel('wheel-front-right').z).toBeLessThan(0);
    expect(wheel('wheel-front-left').x).toBeLessThan(0);
    expect(wheel('wheel-back-left').x).toBeLessThan(0);
  });

  it('AT4: wheel geometry is centred at the hub with tyre diameter y-extent', async () => {
    const doc = await new NodeIO().read(GLB_PATH);
    const scene = doc.getRoot().listScenes()[0];
    const meta = readMeta();
    for (const name of WHEEL_NODE_NAMES) {
      const node = scene.listChildren().find((n) => n.getName() === name);
      if (!node) throw new Error(`missing wheel node ${name}`);
      const { min, max } = localBounds(node);
      const cx = (min[0] + max[0]) / 2;
      const cy = (min[1] + max[1]) / 2;
      const cz = (min[2] + max[2]) / 2;
      expect(Math.abs(cx)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(cy)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(cz)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(max[1] - min[1] - 2 * meta.wheelRadius)).toBeLessThanOrEqual(0.02);
    }
  });

  it('AT5: model bbox is on the ground with real length and width', async () => {
    const doc = await new NodeIO().read(GLB_PATH);
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(min[1]).toBeGreaterThanOrEqual(-0.02);
    expect(Math.abs(max[2] - min[2] - 4.29)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(max[0] - min[0] - 1.74)).toBeLessThanOrEqual(0.08);
  });
});

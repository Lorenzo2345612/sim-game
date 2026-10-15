import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document, Node as GltfNode } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');
const CONFIG_DIR = join(ROOT, 'assets', 'cars');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const NEW_CARS = [
  { id: 'lmp2-a', source: 'assets/vendor/cars/katattak-ka01/katattak_ka01_lmp2_prototype_full.glb' },
  {
    id: 'hyper-a',
    source: 'assets/vendor/cars/cadillac-v-series-r/2023_-_2026_cadillac_v-series.r_lmdh_hypercar.glb',
  },
];

interface WheelEntry {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface CarMeta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: WheelEntry[];
}

const built = new Map<string, Promise<{ doc: Document; meta: CarMeta }>>();

function ensureBuilt(id: string): Promise<{ doc: Document; meta: CarMeta }> {
  let hit = built.get(id);
  if (!hit) {
    hit = (async () => {
      if (!existsSync(join(MODELS, `${id}.glb`))) await buildCar(id);
      const doc = await new NodeIO().read(join(MODELS, `${id}.glb`));
      const meta = JSON.parse(readFileSync(join(MODELS, `${id}.json`), 'utf8')) as CarMeta;
      return { doc, meta };
    })();
    built.set(id, hit);
  }
  return hit;
}

function wheelOf(meta: CarMeta, name: string): WheelEntry {
  const hit = meta.wheels.find((w) => w.name === name);
  if (!hit) throw new Error(`missing wheel ${name}`);
  return hit;
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

function localHalfHeight(node: GltfNode): number {
  let min = Infinity;
  let max = -Infinity;
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
        if (pMin[1] < min) min = pMin[1];
        if (pMax[1] > max) max = pMax[1];
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return (max - min) / 2;
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

describe('112 prototype models post checks', () => {
  it('POST1: every prototype config points at a source glb that exists on disk', () => {
    for (const car of NEW_CARS) {
      const path = join(CONFIG_DIR, `${car.id}.pipeline.json`);
      expect(existsSync(path), `${car.id} config`).toBe(true);
      const config = JSON.parse(readFileSync(path, 'utf8')) as { source: string };
      expect(config.source, car.id).toBe(car.source);
      expect(existsSync(join(ROOT, config.source)), `${car.id} source`).toBe(true);
    }
  });

  it.each(NEW_CARS)('POST2: $id axle is straight, its wheel z matching within 2 cm', async (car) => {
    const { meta } = await ensureBuilt(car.id);
    const fl = wheelOf(meta, 'wheel-front-left');
    const fr = wheelOf(meta, 'wheel-front-right');
    const bl = wheelOf(meta, 'wheel-back-left');
    const br = wheelOf(meta, 'wheel-back-right');
    expect(Math.abs(fl.z - fr.z), `${car.id} front axle`).toBeLessThanOrEqual(0.02);
    expect(Math.abs(bl.z - br.z), `${car.id} rear axle`).toBeLessThanOrEqual(0.02);
  });

  it.each(NEW_CARS)(
    'POST3: $id body node holds vertices and outweighs every single wheel node',
    async (car) => {
      const { doc } = await ensureBuilt(car.id);
      const body = vertexCount(findNode(doc, 'body'));
      expect(body, car.id).toBeGreaterThan(0);
      for (const name of WHEEL_NODE_NAMES) {
        expect(body, `${car.id} body vs ${name}`).toBeGreaterThan(vertexCount(findNode(doc, name)));
      }
    },
  );

  it.each(NEW_CARS)('POST5: $id hub heights agree within 5 cm (same-size tyres on flat ground)', async (car) => {
    const { meta } = await ensureBuilt(car.id);
    const ys = meta.wheels.map((w) => w.y);
    expect(Math.max(...ys) - Math.min(...ys), car.id).toBeLessThanOrEqual(0.05);
  }, 300000);

  it.each(NEW_CARS)('POST6: $id wheelRadius matches every wheel half-height within 2 cm', async (car) => {
    const { doc, meta } = await ensureBuilt(car.id);
    for (const name of WHEEL_NODE_NAMES) {
      const half = localHalfHeight(findNode(doc, name));
      expect(Math.abs(half - meta.wheelRadius), `${car.id} ${name}`).toBeLessThanOrEqual(0.02);
    }
  }, 300000);

  it('POST7: the five legacy pipeline configs stay byte-identical to their pinned hashes', () => {
    const legacy: Record<string, string> = {
      f4: '04bda743c4c8a3cd59a36bf578bab248fcda903a1c71d2ebb764920210b4d49a',
      'gt3-a': 'a507b70877066caf5248cd6cd231c9d8882c916b0b873ce7aac39e8ed1570a61',
      'gt3-b': 'bcac6d8d900567dad305190cce30dd998d6c0b910d576736daaf62e22a5abdb8',
      'gt3-c': '85fbf20e33ab6f04fa2be03c459354323ad99bc5d3da9bb415bac389db70984b',
      'gt3-d': 'b44ca129e638d27f261bdec716530da3f2d6c021b60b90f917a86b17debebe94',
    };
    for (const [id, hash] of Object.entries(legacy)) {
      const path = join(CONFIG_DIR, `${id}.pipeline.json`);
      expect(existsSync(path), id).toBe(true);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex'), id).toBe(hash);
    }
  });

  it.each(NEW_CARS)('POST8: $id glb header is valid and its json numbers are finite, positive and bounded', async (car) => {
    await ensureBuilt(car.id);
    const glb = readFileSync(join(MODELS, `${car.id}.glb`));
    expect(glb.subarray(0, 4).toString('ascii'), 'magic').toBe('glTF');
    expect(glb.readUInt32LE(4), 'version').toBe(2);
    expect(glb.readUInt32LE(8), 'declared length').toBe(glb.length);
    const meta = JSON.parse(readFileSync(join(MODELS, `${car.id}.json`), 'utf8')) as CarMeta;
    expect(meta.wheelRadius, 'wheelRadius').toBeGreaterThan(0);
    expect(meta.wheelbase, 'wheelbase').toBeGreaterThan(0);
    expect(meta.trackFront, 'trackFront').toBeGreaterThan(0);
    expect(meta.trackRear, 'trackRear').toBeGreaterThan(0);
    for (const w of meta.wheels) {
      for (const v of [w.x, w.y, w.z]) {
        expect(Number.isFinite(v), `${car.id} ${w.name}`).toBe(true);
        expect(Math.abs(v), `${car.id} ${w.name}`).toBeLessThan(10);
      }
    }
  }, 300000);

  it.each(NEW_CARS)('POST9: $id tracks are narrower than the overall model width', async (car) => {
    const { doc, meta } = await ensureBuilt(car.id);
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    const width = max[0] - min[0];
    expect(meta.trackFront, `${car.id} trackFront`).toBeLessThan(width);
    expect(meta.trackRear, `${car.id} trackRear`).toBeLessThan(width);
  }, 300000);
});

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

type WheelName = (typeof WHEEL_NODE_NAMES)[number];

const NEW_CARS = [
  {
    id: 'lmp2-a',
    source: 'assets/vendor/cars/katattak-ka01/katattak_ka01_lmp2_prototype_full.glb',
    targetLength: 4.745,
  },
  {
    id: 'lmp2-b',
    source: 'assets/vendor/cars/ligier-js-px/ligier_js_px.glb',
    targetLength: 4.745,
  },
  {
    id: 'hyper-a',
    source: 'assets/vendor/cars/cadillac-v-series-r/2023_-_2026_cadillac_v-series.r_lmdh_hypercar.glb',
    targetLength: 5.1,
  },
  {
    id: 'hyper-b',
    source: 'assets/vendor/cars/ferrari-499p/2023_-_2026_ferrari_499p.glb',
    targetLength: 4.995,
  },
];

const LICENSE_ROWS = [
  {
    id: 'lmp2-a',
    asset: 'LMP2 car A source (original design)',
    author: 'mosigana',
    url: 'https://sketchfab.com/3d-models/6044bd804bed4ac4b9f0c782c5c3459b',
  },
  {
    id: 'lmp2-b',
    asset: 'LMP2 car B source (real-brand shape, dev only; de-brand before release)',
    author: 'Kerdak123',
    url: 'https://sketchfab.com/3d-models/72432f51423d429e93f4981563d76fb8',
  },
  {
    id: 'hyper-a',
    asset: 'Hypercar A source (real-brand shape, dev only; de-brand before release)',
    author: 'supranakamura',
    url: 'https://sketchfab.com/3d-models/efe600b0b1694e2aae055f35db3aaeda',
  },
  {
    id: 'hyper-b',
    asset: 'Hypercar B source (real-brand shape, dev only; de-brand before release)',
    author: 'supranakamura',
    url: 'https://sketchfab.com/3d-models/359b41f7c14941c8bceafbc3ac98c537',
  },
];

const QUADRANT: Record<WheelName, { left: boolean; front: boolean }> = {
  'wheel-front-left': { left: true, front: true },
  'wheel-front-right': { left: false, front: true },
  'wheel-back-left': { left: true, front: false },
  'wheel-back-right': { left: false, front: false },
};

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

interface CarConfig {
  source: string;
  targetLength: number;
  triBudget: number;
  outGlb: string;
  outJson: string;
}

const built = new Map<string, { doc: Document; meta: CarMeta }>();

async function ensureBuilt(id: string): Promise<{ doc: Document; meta: CarMeta }> {
  const hit = built.get(id);
  if (hit) return hit;
  await buildCar(id);
  const doc = await new NodeIO().read(join(MODELS, `${id}.glb`));
  const meta = JSON.parse(readFileSync(join(MODELS, `${id}.json`), 'utf8')) as CarMeta;
  const entry = { doc, meta };
  built.set(id, entry);
  return entry;
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

function readConfig(id: string): CarConfig {
  const path = join(CONFIG_DIR, `${id}.pipeline.json`);
  expect(existsSync(path), `${id} config`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8')) as CarConfig;
}

describe('112 prototype models edges', () => {
  it('EDGE1: a second build of each prototype writes byte-identical glb and json', async () => {
    for (const { id } of NEW_CARS) {
      await ensureBuilt(id);
      const glb = readFileSync(join(MODELS, `${id}.glb`));
      const json = readFileSync(join(MODELS, `${id}.json`));
      await buildCar(id);
      expect(readFileSync(join(MODELS, `${id}.glb`)).equals(glb), `${id} glb`).toBe(true);
      expect(readFileSync(join(MODELS, `${id}.json`)).equals(json), `${id} json`).toBe(true);
    }
  }, 900000);

  it('EDGE2: ASSETS_LICENSES.md carries one row per prototype source with author, URL, CC-BY 4.0 and NC no', () => {
    const text = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
    for (const row of LICENSE_ROWS) {
      const lines = text.split('\n').filter((line) => line.includes(row.asset));
      expect(lines, `${row.id} row`).toHaveLength(1);
      const line = lines[0];
      expect(line.includes(row.author), `${row.id} author`).toBe(true);
      expect(line.includes(row.url), `${row.id} url`).toBe(true);
      expect(line.includes('CC-BY 4.0'), `${row.id} license`).toBe(true);
      expect(/\|\s*no\s*\|\s*$/.test(line.trimEnd()), `${row.id} NC`).toBe(true);
    }
  });

  it('EDGE3: rear hubs sit at z > 0 and right hubs at x > 0', async () => {
    for (const { id } of NEW_CARS) {
      const { meta } = await ensureBuilt(id);
      expect(wheelOf(meta, 'wheel-back-left').z, id).toBeGreaterThan(0);
      expect(wheelOf(meta, 'wheel-back-right').z, id).toBeGreaterThan(0);
      expect(wheelOf(meta, 'wheel-front-right').x, id).toBeGreaterThan(0);
      expect(wheelOf(meta, 'wheel-back-right').x, id).toBeGreaterThan(0);
    }
  }, 300000);

  it('EDGE4: the lowest wheel vertex of each prototype sits on the ground plane', async () => {
    for (const { id } of NEW_CARS) {
      const { doc } = await ensureBuilt(id);
      const lows = WHEEL_NODE_NAMES.map((name) => getBounds(findNode(doc, name)).min[1]);
      expect(Math.abs(Math.min(...lows)), id).toBeLessThanOrEqual(0.02);
    }
  }, 300000);

  it('EDGE5: each prototype json has exactly the f4.json shape', async () => {
    for (const { id } of NEW_CARS) {
      const { meta } = await ensureBuilt(id);
      expect(Object.keys(meta).sort(), id).toEqual(
        ['wheelRadius', 'wheelbase', 'trackFront', 'trackRear', 'wheels'].sort(),
      );
      expect(meta.wheels.length, id).toBe(4);
      expect(meta.wheels.map((w) => w.name).sort(), id).toEqual([...WHEEL_NODE_NAMES].sort());
      for (const w of meta.wheels) {
        expect(Object.keys(w).sort(), `${id} ${w.name}`).toEqual(['name', 'x', 'y', 'z'].sort());
      }
    }
  }, 300000);

  it('EDGE6: prototype wheelbase and track values match the hub coordinates within 1 cm', async () => {
    for (const { id } of NEW_CARS) {
      const { meta } = await ensureBuilt(id);
      const fl = wheelOf(meta, 'wheel-front-left');
      const fr = wheelOf(meta, 'wheel-front-right');
      const bl = wheelOf(meta, 'wheel-back-left');
      const br = wheelOf(meta, 'wheel-back-right');
      const zFront = (fl.z + fr.z) / 2;
      const zRear = (bl.z + br.z) / 2;
      expect(Math.abs(meta.wheelbase - Math.abs(zFront - zRear)), id).toBeLessThanOrEqual(0.01);
      expect(Math.abs(meta.trackFront - Math.abs(fr.x - fl.x)), id).toBeLessThanOrEqual(0.01);
      expect(Math.abs(meta.trackRear - Math.abs(br.x - bl.x)), id).toBeLessThanOrEqual(0.01);
    }
  }, 300000);

  it('EDGE7: each prototype wheel node translation equals its json hub within 1 cm', async () => {
    for (const { id } of NEW_CARS) {
      const { doc, meta } = await ensureBuilt(id);
      for (const name of WHEEL_NODE_NAMES) {
        const t = findNode(doc, name).getWorldTranslation();
        const w = wheelOf(meta, name);
        expect(Math.abs(t[0] - w.x), `${id} ${name} x`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(t[1] - w.y), `${id} ${name} y`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(t[2] - w.z), `${id} ${name} z`).toBeLessThanOrEqual(0.01);
      }
    }
  }, 300000);

  it('EDGE8: prototype materials are renamed to livery, tyre, rim or body_<n>', async () => {
    for (const { id } of NEW_CARS) {
      const { doc } = await ensureBuilt(id);
      const names = doc.getRoot().listMaterials().map((m) => m.getName());
      for (const name of names) {
        const ok = name === 'livery' || name === 'tyre' || name === 'rim' || /^body_\d+$/.test(name);
        expect(ok, `${id} material ${name}`).toBe(true);
      }
      expect(names.some((n) => n === 'tyre' || n === 'rim'), id).toBe(true);
    }
  }, 300000);

  it('EDGE9: the four prototype configs pin source, targetLength, triBudget 70000 and the output paths', () => {
    for (const car of NEW_CARS) {
      const config = readConfig(car.id);
      expect(config.source, car.id).toBe(car.source);
      expect(config.targetLength, car.id).toBeCloseTo(car.targetLength, 6);
      expect(config.triBudget, car.id).toBe(70000);
      expect(config.outGlb, car.id).toBe(`public/models/${car.id}.glb`);
      expect(config.outJson, car.id).toBe(`public/models/${car.id}.json`);
    }
  });

  it('EDGE10: each prototype wheel holds vertices and lies entirely in its own quadrant', async () => {
    for (const { id } of NEW_CARS) {
      const { doc } = await ensureBuilt(id);
      for (const name of WHEEL_NODE_NAMES) {
        const node = findNode(doc, name);
        expect(vertexCount(node), `${id} ${name} vertices`).toBeGreaterThan(0);
        const bounds = getBounds(node);
        const side = QUADRANT[name];
        if (side.left) expect(bounds.max[0], `${id} ${name}`).toBeLessThan(0);
        else expect(bounds.min[0], `${id} ${name}`).toBeGreaterThan(0);
        if (side.front) expect(bounds.max[2], `${id} ${name}`).toBeLessThan(0);
        else expect(bounds.min[2], `${id} ${name}`).toBeGreaterThan(0);
      }
    }
  }, 300000);
});

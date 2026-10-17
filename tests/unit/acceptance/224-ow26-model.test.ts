import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const EXISTING_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d', 'lmp2-a', 'hyper-a'];
const BRANDS = [
  'mclaren',
  'porsche',
  'porche',
  'audi',
  'tatuus',
  'lamborghini',
  'fia',
  'formula',
  'ferrari',
  'mercedes',
  'redbull',
  'red bull',
  'cadillac',
  'sauber',
  'haas',
];
const TRI_BUDGET = 70000;

interface CarMeta {
  wheels: { name: string; x: number; y: number; z: number }[];
}

const BEFORE = EXISTING_IDS.map((id) => ({
  id,
  glb: readFileSync(join(MODELS, `${id}.glb`)),
  json: readFileSync(join(MODELS, `${id}.json`)),
}));

const GLB = join(MODELS, 'ow26.glb');
const META = join(MODELS, 'ow26.json');

async function readDoc(): Promise<Document> {
  return new NodeIO().read(GLB);
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

describe('224 ow26 model acceptance', () => {
  beforeAll(() => {
    execSync('npm run build:cars', { cwd: ROOT, stdio: 'pipe', timeout: 1200000 });
  }, 1200000);

  it('AT1: build:cars writes ow26.glb and ow26.json and keeps the other model outputs byte-identical', () => {
    expect(existsSync(GLB)).toBe(true);
    expect(existsSync(META)).toBe(true);
    for (const { id, glb, json } of BEFORE) {
      expect(readFileSync(join(MODELS, `${id}.glb`)).equals(glb), `${id} glb`).toBe(true);
      expect(readFileSync(join(MODELS, `${id}.json`)).equals(json), `${id} json`).toBe(true);
    }
  });

  it('AT2: ow26 glb has body plus the four wheel root nodes and at most 70000 triangles', async () => {
    const doc = await readDoc();
    const names = doc
      .getRoot()
      .listScenes()[0]
      .listChildren()
      .map((n) => n.getName())
      .sort();
    expect(names).toEqual(['body', ...WHEEL_NODE_NAMES].sort());
    expect(triangleCount(doc)).toBeLessThanOrEqual(TRI_BUDGET);
  });

  it('AT3: ow26 length is 5.27 +- 0.05, height at most 1.2 and width including wheels 1.97 +- 0.05', async () => {
    const doc = await readDoc();
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(Math.abs(max[2] - min[2] - 5.27)).toBeLessThanOrEqual(0.05);
    expect(max[1] - min[1]).toBeLessThanOrEqual(1.2);
    expect(Math.abs(max[0] - min[0] - 1.97)).toBeLessThanOrEqual(0.05);
  });

  it('AT4: ow26 glb and json hold no brand or sponsor strings', () => {
    const glb = readFileSync(GLB).toString('latin1').toLowerCase();
    const json = readFileSync(META, 'utf8').toLowerCase();
    for (const brand of BRANDS) {
      expect(glb, `glb ${brand}`).not.toContain(brand);
      expect(json, `json ${brand}`).not.toContain(brand);
    }
  });

  it('AT5: public/cars/ow26.json wheel x/z match the model json within 1e-3', () => {
    const meta = JSON.parse(readFileSync(META, 'utf8')) as CarMeta;
    const car = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8')) as {
      wheels: { positions: number[][] };
    };
    WHEEL_NODE_NAMES.forEach((name, i) => {
      const wheel = meta.wheels.find((w) => w.name === name);
      if (!wheel) throw new Error(`missing wheel ${name}`);
      expect(Math.abs(car.wheels.positions[i][0] - wheel.x), `${name} x`).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(car.wheels.positions[i][2] - wheel.z), `${name} z`).toBeLessThanOrEqual(1e-3);
    });
  });
});

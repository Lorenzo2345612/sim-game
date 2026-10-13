import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document, Node as GltfNode } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const ALL_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c'];
const GT3_IDS = ['gt3-a', 'gt3-b', 'gt3-c'];

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

const docs = new Map<string, Document>();
const metas = new Map<string, CarMeta>();

async function load(id: string): Promise<{ doc: Document; meta: CarMeta }> {
  if (!docs.has(id)) docs.set(id, await new NodeIO().read(join(MODELS, `${id}.glb`)));
  if (!metas.has(id)) {
    metas.set(id, JSON.parse(readFileSync(join(MODELS, `${id}.json`), 'utf8')) as CarMeta);
  }
  return { doc: docs.get(id) as Document, meta: metas.get(id) as CarMeta };
}

function wheelOf(meta: CarMeta, name: string): WheelEntry {
  const hit = meta.wheels.find((w) => w.name === name);
  if (!hit) throw new Error(`missing wheel ${name}`);
  return hit;
}

function rootNodes(doc: Document): Map<string, GltfNode> {
  return new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n]));
}

function glbAsset(path: string): Record<string, unknown> {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    asset?: Record<string, unknown>;
  };
  return json.asset ?? {};
}

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildCar-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  cpSync(join(ROOT, 'assets'), join(work, 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

describe('071 car pipeline edges', () => {
  beforeAll(async () => {
    for (const id of ALL_IDS) await buildCar(id);
  }, 300000);

  it('EDGE1: buildCar throws for an unknown config id', async () => {
    let error: unknown;
    try {
      await buildCar('does-not-exist');
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
  });

  it('EDGE2: the CLI builds a car from its id into <id>.glb and <id>.json', () => {
    const work = sandbox();
    try {
      execFileSync(TSX, ['tools/assets/buildCar.ts', 'f4'], { cwd: work, stdio: 'pipe' });
      const glb = readFileSync(join(work, 'public', 'models', 'f4.glb'));
      const json = readFileSync(join(work, 'public', 'models', 'f4.json'), 'utf8');
      expect(glb.length).toBeGreaterThan(0);
      expect(json.length).toBeGreaterThan(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 600000);

  it('EDGE3: the build throws when the config source glb is missing', () => {
    const work = sandbox();
    try {
      const configPath = join(work, 'assets', 'cars', 'gt3-c.pipeline.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { source: string };
      config.source = 'assets/vendor/cars/__missing_source__/missing.glb';
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      let failed = false;
      try {
        execFileSync(TSX, ['tools/assets/buildCar.ts', 'gt3-c'], { cwd: work, stdio: 'pipe' });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 600000);

  it('EDGE4: gt3 materials are renamed to livery, tyre, rim or body_<n>', async () => {
    for (const id of GT3_IDS) {
      const { doc } = await load(id);
      const names = doc.getRoot().listMaterials().map((m) => m.getName());
      for (const name of names) {
        const ok = name === 'livery' || name === 'tyre' || name === 'rim' || /^body_\d+$/.test(name);
        expect(ok, `${id} material ${name}`).toBe(true);
      }
      expect(names.some((n) => n === 'tyre' || n === 'rim'), id).toBe(true);
    }
  });

  it('EDGE5: the gt3 livery material uses the default base colour #c8102e', async () => {
    for (const id of GT3_IDS) {
      const { doc } = await load(id);
      const livery = doc.getRoot().listMaterials().find((m) => m.getName() === 'livery');
      if (!livery) throw new Error(`missing livery material in ${id}`);
      const c = livery.getBaseColorFactor();
      expect(c[0], id).toBeCloseTo(200 / 255, 4);
      expect(c[1], id).toBeCloseTo(16 / 255, 4);
      expect(c[2], id).toBeCloseTo(46 / 255, 4);
      expect(c[3], id).toBeCloseTo(1, 4);
    }
  });

  it('EDGE6: asset.extras is stripped from every output glb', () => {
    for (const id of ALL_IDS) {
      const asset = glbAsset(join(MODELS, `${id}.glb`));
      expect(Object.keys(asset), id).not.toContain('extras');
    }
  });

  it('EDGE7: each output json has exactly the f4.json shape', async () => {
    for (const id of ALL_IDS) {
      const { meta } = await load(id);
      expect(Object.keys(meta).sort(), id).toEqual(
        ['wheelRadius', 'wheelbase', 'trackFront', 'trackRear', 'wheels'].sort(),
      );
      expect(meta.wheels.length, id).toBe(4);
      expect(meta.wheels.map((w) => w.name).sort(), id).toEqual([...WHEEL_NODE_NAMES].sort());
      for (const w of meta.wheels) {
        expect(Object.keys(w).sort(), `${id} ${w.name}`).toEqual(['name', 'x', 'y', 'z'].sort());
      }
    }
  });

  it('EDGE8: wheelbase and tracks match the hub coordinates within 1 cm', async () => {
    for (const id of ALL_IDS) {
      const { meta } = await load(id);
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
  });

  it('EDGE9: each wheel node translation equals its json hub within 1 cm', async () => {
    for (const id of ALL_IDS) {
      const { doc, meta } = await load(id);
      const nodes = rootNodes(doc);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing node ${name} in ${id}`);
        const t = node.getWorldTranslation();
        const w = wheelOf(meta, name);
        expect(Math.abs(t[0] - w.x), `${id} ${name} x`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(t[1] - w.y), `${id} ${name} y`).toBeLessThanOrEqual(0.01);
        expect(Math.abs(t[2] - w.z), `${id} ${name} z`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('EDGE10: each gt3 wheel geometry lies entirely in its own quadrant', async () => {
    const side: Record<string, { left: boolean; front: boolean }> = {
      'wheel-front-left': { left: true, front: true },
      'wheel-front-right': { left: false, front: true },
      'wheel-back-left': { left: true, front: false },
      'wheel-back-right': { left: false, front: false },
    };
    for (const id of GT3_IDS) {
      const { doc } = await load(id);
      const nodes = rootNodes(doc);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing node ${name} in ${id}`);
        const bounds = getBounds(node);
        const s = side[name];
        if (s.left) expect(bounds.max[0], `${id} ${name}`).toBeLessThan(0);
        else expect(bounds.min[0], `${id} ${name}`).toBeGreaterThan(0);
        if (s.front) expect(bounds.max[2], `${id} ${name}`).toBeLessThan(0);
        else expect(bounds.min[2], `${id} ${name}`).toBeGreaterThan(0);
      }
    }
  });
});

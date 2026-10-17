import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import type { Document, Node as GltfNode, Primitive } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const GLB = join(ROOT, 'public', 'models', 'ow26.glb');
const META = join(ROOT, 'public', 'models', 'ow26.json');
const CONFIG = join(ROOT, 'assets', 'cars', 'ow26.pipeline.json');
const WHEELS = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];

interface Config {
  source: string;
  forward: string;
  targetLength: number;
  wheelMaterials: string[];
  liveryMaterials: string[];
  dropNodes?: string[];
  neutralMaterials?: string[];
  wheelTriBudget?: number;
  triBudget: number;
  outGlb: string;
  outJson: string;
}

interface Meta {
  paintMaterials: string[];
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

function readConfig(): Config {
  return JSON.parse(readFileSync(CONFIG, 'utf8')) as Config;
}

function readMeta(): Meta {
  return JSON.parse(readFileSync(META, 'utf8')) as Meta;
}

function readDoc(): Promise<Document> {
  return new NodeIO().read(GLB);
}

function sceneNodes(doc: Document): Map<string, GltfNode> {
  return new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n]));
}

function primTris(prim: Primitive): number {
  const idx = prim.getIndices();
  const pos = prim.getAttribute('POSITION');
  return idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
}

function nodeTris(node: GltfNode): number {
  return (node.getMesh()?.listPrimitives() ?? []).reduce((sum, prim) => sum + primTris(prim), 0);
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

describe('224 ow26 model post-code gaps', () => {
  it('POST1: the pipeline config pins forward +z, the de-brand lists and the wheel budget', () => {
    const cfg = readConfig();
    expect(cfg.source).toBe('assets/vendor/cars/ow26-src/ow26-source.glb');
    expect(existsSync(join(ROOT, cfg.source))).toBe(true);
    expect(cfg.forward).toBe('+z');
    expect(cfg.liveryMaterials).toEqual([]);
    expect(cfg.wheelMaterials).toEqual(['TIRE_SIDES', 'TIRE_TREAD', 'redbull_wheel_hub', 'discs']);
    expect(cfg.dropNodes).toEqual(['decals_layer1']);
    expect(cfg.neutralMaterials).toEqual([
      'redbull_detail',
      'redbull_wheel_hub',
      'decal',
      'TAG_DRS_ON',
      'gp21_LCD',
      'chasis',
      'chassis2',
      'generics',
      'cockpit_metal',
      'gp21_cinture',
    ]);
    expect(cfg.wheelTriBudget).toBe(20000);
  });

  it('POST2: the built wheels stay inside the config wheelTriBudget', async () => {
    const cfg = readConfig();
    const doc = await readDoc();
    const nodes = sceneNodes(doc);
    const total = WHEELS.reduce((sum, name) => sum + nodeTris(nodes.get(name) as GltfNode), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(cfg.wheelTriBudget as number);
  });

  it('POST3: every model json number is quantised to 6 decimals and the tracks match the wheels', () => {
    const scan = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        expect(round6(value), `${path} = ${value}`).toBe(value);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`);
      }
    };
    scan(readMeta(), 'meta');
    const meta = readMeta();
    const wheel = (name: string) => {
      const hit = meta.wheels.find((w) => w.name === name);
      if (!hit) throw new Error(`missing ${name}`);
      return hit;
    };
    expect(meta.trackFront).toBeCloseTo(wheel('wheel-front-right').x - wheel('wheel-front-left').x, 6);
    expect(meta.trackRear).toBeCloseTo(wheel('wheel-back-right').x - wheel('wheel-back-left').x, 6);
    expect(meta.wheelbase).toBeCloseTo(wheel('wheel-back-left').z - wheel('wheel-front-left').z, 6);
    expect(meta.paintMaterials).toHaveLength(1);
  });

  it('POST4: ow26 nodes are childless and translation-only, with clean finite geometry', async () => {
    const doc = await readDoc();
    const nodes = sceneNodes(doc);
    expect([...nodes.keys()].sort()).toEqual(['body', ...WHEELS].sort());
    for (const [name, node] of nodes) {
      expect(node.listChildren(), name).toEqual([]);
      expect(node.getScale(), name).toEqual([1, 1, 1]);
      const rot = node.getRotation();
      expect(rot, name).toEqual([0, 0, 0, 1]);
      if (name === 'body') expect(node.getTranslation(), name).toEqual([0, 0, 0]);
      for (const prim of node.getMesh()?.listPrimitives() ?? []) {
        expect(prim.getMode(), name).toBe(4);
        const pos = prim.getAttribute('POSITION');
        const nrm = prim.getAttribute('NORMAL');
        const idx = prim.getIndices();
        if (!pos || !nrm || !idx) throw new Error(`${name} primitive missing attributes`);
        const pa = pos.getArray() as Float32Array;
        const na = nrm.getArray() as Float32Array;
        const ia = idx.getArray() as Uint16Array | Uint32Array;
        expect(pa.length % 3, name).toBe(0);
        for (let i = 0; i < pa.length; i++) expect(Number.isFinite(pa[i]), name).toBe(true);
        for (let i = 0; i < na.length; i++) expect(Number.isFinite(na[i]), name).toBe(true);
        for (const v of ia) expect(v, name).toBeLessThan(pa.length / 3);
      }
    }
  });

  it('POST5: the paint material named in the model json exists in the glb', async () => {
    const doc = await readDoc();
    const meta = readMeta();
    const names = doc.getRoot().listMaterials().map((m) => m.getName());
    for (const paint of meta.paintMaterials) expect(names, paint).toContain(paint);
  });

  it('POST6: building ow26 twice produces byte-identical outputs', async () => {
    await buildCar('ow26');
    const glb1 = readFileSync(GLB);
    const json1 = readFileSync(META, 'utf8');
    await buildCar('ow26');
    expect(readFileSync(GLB).equals(glb1)).toBe(true);
    expect(readFileSync(META, 'utf8')).toBe(json1);
  }, 120000);
});

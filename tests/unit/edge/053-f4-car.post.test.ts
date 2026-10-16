import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import type { Node as GltfNode } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const GLB_PATH = join(ROOT, 'public', 'models', 'f4.glb');
const JSON_PATH = join(ROOT, 'public', 'models', 'f4.json');
const VENDOR = join(ROOT, 'assets', 'vendor', 'f4');
const SOURCE_NAME = 'f4_tatuus_t014_chasis.glb';

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
];

interface WheelEntry {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface F4Meta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: WheelEntry[];
}

interface Loaded {
  doc: Awaited<ReturnType<NodeIO['read']>>;
  meta: F4Meta;
  rawMeta: Record<string, unknown>;
  nodes: Map<string, GltfNode>;
}

let cached: Loaded | null = null;

async function load(): Promise<Loaded> {
  if (cached) return cached;
  const doc = await new NodeIO().read(GLB_PATH);
  const rawMeta = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as Record<string, unknown>;
  const meta = rawMeta as unknown as F4Meta;
  const scene = doc.getRoot().listScenes()[0];
  const nodes = new Map(scene.listChildren().map((n) => [n.getName(), n]));
  cached = { doc, meta, rawMeta, nodes };
  return cached;
}

function nodeOf(nodes: Map<string, GltfNode>, name: string): GltfNode {
  const hit = nodes.get(name);
  if (!hit) throw new Error(`missing node ${name}`);
  return hit;
}

function nodeBounds(node: GltfNode): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const stack: GltfNode[] = [node];
  const v = [0, 0, 0];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const t = current.getWorldTranslation();
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          for (let k = 0; k < 3; k++) {
            const w = v[k] + t[k];
            if (w < min[k]) min[k] = w;
            if (w > max[k]) max[k] = w;
          }
        }
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return { min, max };
}

function makeSandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildF4-post-'));
  mkdirSync(join(work, 'tools', 'assets'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  copyFileSync(join(ROOT, 'tools', 'assets', 'buildF4.ts'), join(work, 'tools', 'assets', 'buildF4.ts'));
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

function runBuild(work: string): { status: number; output: string } {
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  try {
    const output = execFileSync(tsx, ['tools/assets/buildF4.ts'], {
      cwd: work,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return {
      status: e.status ?? -1,
      output: `${e.stdout ?? ''}${e.stderr ?? ''}`,
    };
  }
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else out.push(full);
  }
  return out;
}

function isRounded6(v: number): boolean {
  return v === Math.round(v * 1e6) / 1e6;
}

describe('053 F4 car model post checks', () => {
  it('POST1: livery material base colour is #c8102e', async () => {
    const { doc } = await load();
    const livery = doc.getRoot().listMaterials().find((m) => m.getName() === 'livery');
    if (!livery) throw new Error('missing livery material');
    const c = livery.getBaseColorFactor();
    expect(c[0]).toBeCloseTo(200 / 255, 5);
    expect(c[1]).toBeCloseTo(16 / 255, 5);
    expect(c[2]).toBeCloseTo(46 / 255, 5);
    expect(c[3]).toBeCloseTo(1, 5);
  });

  it('POST2: f4.json has exactly the documented keys, finite positive values and 6-decimal rounding', async () => {
    const { meta, rawMeta } = await load();
    expect(Object.keys(rawMeta).sort()).toEqual(
      ['paintMaterials', 'wheelRadius', 'wheelbase', 'trackFront', 'trackRear', 'wheels'].sort(),
    );
    expect(Array.isArray(meta.wheels)).toBe(true);
    expect(meta.wheels).toHaveLength(4);
    for (const w of meta.wheels) {
      expect(Object.keys(w).sort()).toEqual(['name', 'x', 'y', 'z'].sort());
      for (const v of [w.x, w.y, w.z]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(isRounded6(v)).toBe(true);
      }
    }
    for (const v of [meta.wheelRadius, meta.wheelbase, meta.trackFront, meta.trackRear]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(isRounded6(v)).toBe(true);
    }
  });

  it('POST3: nodes are translation-only, flat and the body sits at the origin', async () => {
    const { doc, nodes } = await load();
    expect(doc.getRoot().listScenes()).toHaveLength(1);
    for (const name of ['body', ...WHEEL_NODE_NAMES]) {
      const node = nodeOf(nodes, name);
      expect(node.listChildren()).toHaveLength(0);
      expect(node.getScale()[0]).toBeCloseTo(1, 6);
      expect(node.getScale()[1]).toBeCloseTo(1, 6);
      expect(node.getScale()[2]).toBeCloseTo(1, 6);
      const r = node.getRotation();
      expect(r[0]).toBeCloseTo(0, 6);
      expect(r[1]).toBeCloseTo(0, 6);
      expect(r[2]).toBeCloseTo(0, 6);
      expect(r[3]).toBeCloseTo(1, 6);
    }
    const body = nodeOf(nodes, 'body');
    expect(body.getTranslation()[0]).toBeCloseTo(0, 6);
    expect(body.getTranslation()[1]).toBeCloseTo(0, 6);
    expect(body.getTranslation()[2]).toBeCloseTo(0, 6);
  });

  it('POST4: every node holds exactly two triangle primitives with only POSITION, NORMAL and indices', async () => {
    const { nodes } = await load();
    const expected: Record<string, string[]> = {
      body: ['caliper', 'livery'],
      'wheel-front-left': ['disc', 'tyre'],
      'wheel-front-right': ['disc', 'tyre'],
      'wheel-back-left': ['disc', 'tyre'],
      'wheel-back-right': ['disc', 'tyre'],
    };
    for (const [name, mats] of Object.entries(expected)) {
      const mesh = nodeOf(nodes, name).getMesh();
      if (!mesh) throw new Error(`missing mesh on ${name}`);
      const prims = mesh.listPrimitives();
      expect(prims).toHaveLength(2);
      const used = prims.map((p) => p.getMaterial()?.getName() ?? '').sort();
      expect(used).toEqual(mats);
      for (const prim of prims) {
        expect(prim.getMode()).toBe(4);
        expect(prim.listAttributes()).toHaveLength(2);
        expect(prim.getAttribute('POSITION')).toBeTruthy();
        expect(prim.getAttribute('NORMAL')).toBeTruthy();
        expect(prim.getAttribute('TEXCOORD_0')).toBeNull();
        expect(prim.getAttribute('TANGENT')).toBeNull();
        expect(prim.getIndices()).toBeTruthy();
      }
    }
  });

  it('POST5: indices stay in range and vertex data is finite', async () => {
    const { doc } = await load();
    let ragged = 0;
    let outOfRange = 0;
    let nonFinite = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const nrm = prim.getAttribute('NORMAL');
        const idx = prim.getIndices();
        if (!pos || !nrm || !idx) throw new Error(`incomplete primitive in ${mesh.getName()}`);
        if (idx.getCount() % 3 !== 0) ragged++;
        const count = pos.getCount();
        const ia = idx.getArray() as Uint16Array | Uint32Array;
        for (let i = 0; i < ia.length; i++) {
          if (ia[i] >= count) outOfRange++;
        }
        for (const arr of [pos.getArray(), nrm.getArray()] as Float32Array[]) {
          for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) nonFinite++;
          }
        }
      }
    }
    expect(ragged).toBe(0);
    expect(outOfRange).toBe(0);
    expect(nonFinite).toBe(0);
  });

  it('POST6: non-degenerate normals have unit length', async () => {
    const { doc } = await load();
    let maxErr = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const nrm = prim.getAttribute('NORMAL');
        if (!nrm) continue;
        const na = nrm.getArray() as Float32Array;
        for (let i = 0; i < na.length; i += 3) {
          const len = Math.hypot(na[i], na[i + 1], na[i + 2]);
          if (len < 1e-6) continue;
          maxErr = Math.max(maxErr, Math.abs(len - 1));
        }
      }
    }
    expect(maxErr).toBeCloseTo(0, 3);
  });

  it('POST7: the car rests on y = 0 and each tyre touches the ground', async () => {
    const { doc, nodes } = await load();
    const whole = getBounds(doc.getRoot().listScenes()[0]);
    expect(Math.abs(whole.min[1])).toBeLessThanOrEqual(0.02);
    for (const name of WHEEL_NODE_NAMES) {
      const b = nodeBounds(nodeOf(nodes, name));
      expect(Math.abs(b.min[1])).toBeLessThanOrEqual(0.02);
    }
  });

  it('POST8: package.json declares build:f4 as tsx tools/assets/buildF4.ts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:f4']).toBe('tsx tools/assets/buildF4.ts');
  });

  it('POST9: the game loads the F4 model from its car spec (057, 073)', () => {
    const carSpec = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as {
      model?: { url?: string };
    };
    expect(carSpec.model?.url).toBe('/models/f4.glb');
    expect(statSync(join(ROOT, 'public', 'models', 'f4.glb')).isFile()).toBe(true);
    const files = walkSources(join(ROOT, 'src'));
    expect(files.some((file) => /model\.url/.test(readFileSync(file, 'utf8')))).toBe(true);
  });

  it('POST10: a fresh build reproduces the committed f4.glb and f4.json byte for byte', () => {
    const work = makeSandbox();
    try {
      cpSync(VENDOR, join(work, 'assets', 'vendor', 'f4'), { recursive: true });
      const result = runBuild(work);
      expect(result.status).toBe(0);
      const builtGlb = readFileSync(join(work, 'public', 'models', 'f4.glb'));
      const builtJson = readFileSync(join(work, 'public', 'models', 'f4.json'));
      expect(builtGlb.length).toBeGreaterThan(0);
      expect(builtJson.length).toBeGreaterThan(0);
      expect(Buffer.compare(builtGlb, readFileSync(GLB_PATH))).toBe(0);
      expect(Buffer.compare(builtJson, readFileSync(JSON_PATH))).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);

  it('POST11: the build fails without writing outputs when the source GLB is missing', () => {
    const work = makeSandbox();
    try {
      const result = runBuild(work);
      expect(result.status).not.toBe(0);
      expect(result.output.length).toBeGreaterThan(0);
      let wrote = true;
      try {
        statSync(join(work, 'public', 'models', 'f4.glb'));
      } catch {
        wrote = false;
      }
      expect(wrote).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it('POST12: the build rejects a source primitive with an unmapped material name', async () => {
    const work = makeSandbox();
    try {
      mkdirSync(join(work, 'assets', 'vendor', 'f4'), { recursive: true });
      const doc = new Document();
      const buffer = doc.createBuffer();
      const material = doc.createMaterial('weird');
      const positions = new Float32Array([
        -1, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 1, 1, 0, 1, 0, 1, 1,
      ]);
      const normals = new Float32Array([
        0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
      ]);
      const prim = doc
        .createPrimitive()
        .setAttribute(
          'POSITION',
          doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(positions),
        )
        .setAttribute(
          'NORMAL',
          doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(normals),
        )
        .setIndices(
          doc
            .createAccessor()
            .setBuffer(buffer)
            .setType('SCALAR')
            .setArray(new Uint32Array([0, 1, 2, 3, 4, 5, 0, 2, 3, 2, 5, 3])),
        );
      prim.setMaterial(material);
      doc.createScene('Scene').addChild(
        doc.createNode('n').setMesh(doc.createMesh('m').addPrimitive(prim)),
      );
      await new NodeIO().write(join(work, 'assets', 'vendor', 'f4', SOURCE_NAME), doc);

      const result = runBuild(work);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('unmapped material');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});

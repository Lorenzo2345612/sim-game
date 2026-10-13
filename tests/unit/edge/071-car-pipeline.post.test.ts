import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
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
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import type { Material, Node as GltfNode, Primitive } from '@gltf-transform/core';
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

const GT3_IDS = ['gt3-a', 'gt3-b', 'gt3-c'];

type Forward = '+x' | '-x' | '+z' | '-z';
type Vec3 = [number, number, number];

interface PartSpec {
  material: string;
  colour: [number, number, number, number];
  boxes: [Vec3, Vec3][];
}

interface WheelEntry {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface CarMeta {
  wheelRadius: number;
  wheels: WheelEntry[];
}

const BODY_BOX: [Vec3, Vec3] = [
  [-0.8, 0.15, -2.2],
  [0.8, 0.95, 1.8],
];
const WHEEL_BOXES: [Vec3, Vec3][] = [
  [
    [-0.97, 0, -1.63],
    [-0.73, 0.66, -0.97],
  ],
  [
    [0.73, 0, -1.63],
    [0.97, 0.66, -0.97],
  ],
  [
    [-0.97, 0, 0.97],
    [-0.73, 0.66, 1.63],
  ],
  [
    [0.73, 0, 0.97],
    [0.97, 0.66, 1.63],
  ],
];
const HUBS: Record<string, Vec3> = {
  'wheel-front-left': [-0.85, 0.33, -1.3],
  'wheel-front-right': [0.85, 0.33, -1.3],
  'wheel-back-left': [-0.85, 0.33, 1.3],
  'wheel-back-right': [0.85, 0.33, 1.3],
};

function invRotate(forward: Forward, x: number, y: number, z: number): Vec3 {
  switch (forward) {
    case '-z':
      return [x, y, z];
    case '+z':
      return [-x, y, -z];
    case '+x':
      return [-z, y, x];
    case '-x':
      return [z, y, -x];
  }
}

function boxArrays(
  min: Vec3,
  max: Vec3,
  forward: Forward,
): { position: number[]; normal: number[]; index: number[] } {
  const faces: [number[], Vec3][] = [
    [[0, 1, 3, 2], [-1, 0, 0]],
    [[4, 6, 7, 5], [1, 0, 0]],
    [[0, 4, 5, 1], [0, -1, 0]],
    [[2, 3, 7, 6], [0, 1, 0]],
    [[0, 2, 6, 4], [0, 0, -1]],
    [[1, 5, 7, 3], [0, 0, 1]],
  ];
  const corner = (i: number): Vec3 => [
    i & 4 ? max[0] : min[0],
    i & 2 ? max[1] : min[1],
    i & 1 ? max[2] : min[2],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const [quad, n] of faces) {
    const base = position.length / 3;
    for (const ci of quad) {
      const p = invRotate(forward, ...corner(ci));
      position.push(p[0], p[1], p[2]);
      const nn = invRotate(forward, n[0], n[1], n[2]);
      normal.push(nn[0], nn[1], nn[2]);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position, normal, index };
}

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildCar-post-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

function f4Sandbox(): string {
  const work = sandbox();
  mkdirSync(join(work, 'assets', 'vendor', 'f4'), { recursive: true });
  copyFileSync(
    join(ROOT, 'assets', 'vendor', 'f4', 'f4_tatuus_t014_chasis.glb'),
    join(work, 'assets', 'vendor', 'f4', 'f4_tatuus_t014_chasis.glb'),
  );
  copyFileSync(
    join(ROOT, 'assets', 'cars', 'f4.pipeline.json'),
    join(work, 'assets', 'cars', 'f4.pipeline.json'),
  );
  return work;
}

function editConfig(work: string, id: string, patch: Record<string, unknown>): void {
  const path = join(work, 'assets', 'cars', `${id}.pipeline.json`);
  const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...config, ...patch }, null, 2)}\n`);
}

function nodeTriangles(node: GltfNode): number {
  let tris = 0;
  for (const prim of node.getMesh()?.listPrimitives() ?? []) tris += primTriangles(prim);
  return tris;
}

async function writeSource(
  work: string,
  name: string,
  parts: PartSpec[],
  forward: Forward,
): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const part of parts) {
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    const position: number[] = [];
    const normal: number[] = [];
    const index: number[] = [];
    for (const [min, max] of part.boxes) {
      const g = boxArrays(min, max, forward);
      const base = position.length / 3;
      position.push(...g.position);
      normal.push(...g.normal);
      for (const v of g.index) index.push(v + base);
    }
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute(
        'POSITION',
        doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(position)),
      )
      .setAttribute(
        'NORMAL',
        doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(normal)),
      )
      .setIndices(
        doc
          .createAccessor()
          .setBuffer(buffer)
          .setType('SCALAR')
          .setArray(new Uint32Array(index)),
      );
    const mesh = doc.createMesh(part.material).addPrimitive(prim);
    scene.addChild(doc.createNode(part.material).setMesh(mesh));
  }
  await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', name), doc);
}

function writeConfig(work: string, id: string, cfg: Record<string, unknown>): void {
  const full = {
    targetLength: 4,
    triBudget: 10000,
    outGlb: `public/models/${id}.glb`,
    outJson: `public/models/${id}.json`,
    ...cfg,
  };
  writeFileSync(
    join(work, 'assets', 'cars', `${id}.pipeline.json`),
    `${JSON.stringify(full, null, 2)}\n`,
  );
}

function runBuild(work: string, args: string[] = []): { status: number; output: string } {
  try {
    const output = execFileSync(TSX, ['tools/assets/buildCar.ts', ...args], {
      cwd: work,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function wheelParts(): PartSpec {
  return { material: 'TYRE_BLK', colour: [0.05, 0.05, 0.05, 1], boxes: WHEEL_BOXES };
}

function bodyParts(): PartSpec {
  return { material: 'SHELL', colour: [0.5, 0.5, 0.5, 1], boxes: [BODY_BOX] };
}

const MARKER_BOX: [Vec3, Vec3] = [
  [-0.3, 0.95, -0.5],
  [0.3, 1.05, 0.5],
];

function markerParts(): PartSpec {
  return { material: 'MIX_PANEL', colour: [0.2, 0.6, 0.2, 1], boxes: [MARKER_BOX] };
}

function readMetaAt(path: string): CarMeta {
  return JSON.parse(readFileSync(path, 'utf8')) as CarMeta;
}

function readDocAt(path: string): Promise<Document> {
  return new NodeIO().read(path);
}

function materialColour(doc: Document, name: string): [number, number, number, number] {
  const hit = doc.getRoot().listMaterials().find((m) => m.getName() === name);
  if (!hit) throw new Error(`missing material ${name}`);
  return hit.getBaseColorFactor();
}

function primTriangles(prim: {
  getIndices: () => { getCount: () => number } | null;
  getAttribute: (n: string) => { getCount: () => number } | null;
}): number {
  const idx = prim.getIndices();
  const pos = prim.getAttribute('POSITION');
  return idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
}

function radialSegments(node: GltfNode): number {
  let maxR = 0;
  const stack: GltfNode[] = [node];
  const clouds: Float32Array[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const arr = pos.getArray() as Float32Array;
        clouds.push(arr);
        for (let i = 0; i < arr.length; i += 3) {
          maxR = Math.max(maxR, Math.hypot(arr[i + 1], arr[i + 2]));
        }
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  const angles = new Set<number>();
  for (const arr of clouds) {
    for (let i = 0; i < arr.length; i += 3) {
      const r = Math.hypot(arr[i + 1], arr[i + 2]);
      if (r < 0.85 * maxR) continue;
      angles.add(Math.round((Math.atan2(arr[i + 2], arr[i + 1]) * 180) / Math.PI));
    }
  }
  return angles.size;
}

function sceneNodes(doc: Document): Map<string, GltfNode> {
  return new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n]));
}

function mergeBoxes(boxes: [Vec3, Vec3][]): { position: number[]; normal: number[]; index: number[] } {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const [min, max] of boxes) {
    const g = boxArrays(min, max, '-z');
    const base = position.length / 3;
    position.push(...g.position);
    normal.push(...g.normal);
    for (const v of g.index) index.push(v + base);
  }
  return { position, normal, index };
}

function addPrim(
  doc: Document,
  material: Material,
  geom: { position: number[]; normal: number[]; index: number[] },
  opts: { normals?: boolean; mode?: 0 | 4 } = {},
): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  if (opts.mode !== undefined) prim.setMode(opts.mode);
  prim.setMaterial(material);
  prim.setAttribute(
    'POSITION',
    doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(geom.position)),
  );
  if (opts.normals !== false) {
    prim.setAttribute(
      'NORMAL',
      doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(geom.normal)),
    );
  }
  prim.setIndices(
    doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(geom.index)),
  );
  return prim;
}

function windingMismatches(node: GltfNode): number {
  let bad = 0;
  const stack: GltfNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const mesh = current.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        const nrm = prim.getAttribute('NORMAL');
        const idx = prim.getIndices();
        if (!pos || !nrm || !idx) continue;
        const pa = pos.getArray() as Float32Array;
        const na = nrm.getArray() as Float32Array;
        const ia = idx.getArray() as Uint16Array | Uint32Array;
        for (let t = 0; t < ia.length; t += 3) {
          const i0 = ia[t] * 3;
          const i1 = ia[t + 1] * 3;
          const i2 = ia[t + 2] * 3;
          const e1 = [pa[i1] - pa[i0], pa[i1 + 1] - pa[i0 + 1], pa[i1 + 2] - pa[i0 + 2]];
          const e2 = [pa[i2] - pa[i0], pa[i2 + 1] - pa[i0 + 1], pa[i2 + 2] - pa[i0 + 2]];
          const g = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const n = [na[i0] + na[i1] + na[i2], na[i0 + 1] + na[i1 + 1] + na[i2 + 1], na[i0 + 2] + na[i1 + 2] + na[i2 + 2]];
          if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] <= 0) bad++;
        }
      }
    }
    for (const child of current.listChildren()) stack.push(child);
  }
  return bad;
}

function bodyPrimStats(node: GltfNode): { tris: number; verts: number; minX: number; maxX: number }[] {
  const out: { tris: number; verts: number; minX: number; maxX: number }[] = [];
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION');
    const arr = pos?.getArray() as Float32Array;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i] < minX) minX = arr[i];
      if (arr[i] > maxX) maxX = arr[i];
    }
    out.push({ tris: primTriangles(prim), verts: pos ? pos.getCount() : 0, minX, maxX });
  }
  return out;
}

describe('071 car pipeline post checks', () => {
  beforeAll(async () => {
    for (const id of GT3_IDS) await buildCar(id);
  }, 300000);

  it('POST1: package.json declares build:cars as tsx tools/assets/buildCar.ts', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:cars']).toBe('tsx tools/assets/buildCar.ts');
  });

  it('POST2: the CLI without arguments builds every pipeline config in assets/cars', async () => {
    const work = sandbox();
    try {
      for (const id of ['alpha', 'beta']) {
        writeConfig(work, id, {
          source: 'assets/vendor/synth/multi.glb',
          forward: '-z',
          wheelMaterials: ['tyre_blk'],
          liveryMaterials: ['shell'],
        });
      }
      await writeSource(work, 'multi.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work);
      expect(result.status).toBe(0);
      for (const id of ['alpha', 'beta']) {
        expect(existsSync(join(work, 'public', 'models', `${id}.glb`)), id).toBe(true);
        expect(existsSync(join(work, 'public', 'models', `${id}.json`)), id).toBe(true);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  for (const forward of ['+x', '-x', '+z', '-z'] as Forward[]) {
    it(`POST3: forward ${forward} rotates the source so the nose ends up at -Z`, async () => {
      const work = sandbox();
      try {
        writeConfig(work, 'rot', {
          source: 'assets/vendor/synth/rot.glb',
          forward,
          wheelMaterials: ['tyre_blk'],
          liveryMaterials: ['shell'],
        });
        await writeSource(work, 'rot.glb', [bodyParts(), wheelParts()], forward);
        const result = runBuild(work, ['rot']);
        expect(result.status).toBe(0);
        const meta = readMetaAt(join(work, 'public', 'models', 'rot.json'));
        for (const name of WHEEL_NODE_NAMES) {
          const wheel = meta.wheels.find((w) => w.name === name);
          if (!wheel) throw new Error(`missing wheel ${name}`);
          const hub = HUBS[name];
          expect(Math.abs(wheel.x - hub[0]), `${name} x`).toBeLessThanOrEqual(0.02);
          expect(Math.abs(wheel.y - hub[1]), `${name} y`).toBeLessThanOrEqual(0.02);
          expect(Math.abs(wheel.z - hub[2]), `${name} z`).toBeLessThanOrEqual(0.02);
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }, 60000);
  }

  it('POST4: material patterns match by case-insensitive substring', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'case', {
        source: 'assets/vendor/synth/case.glb',
        forward: '-z',
        wheelMaterials: ['TYRE_blk'],
        liveryMaterials: ['sHeLL'],
      });
      await writeSource(work, 'case.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['case']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'case.glb'));
      const names = doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .sort();
      expect(names).toEqual(['livery', 'tyre']);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST5: livery patterns win over wheel patterns on the same material', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'prec', {
        source: 'assets/vendor/synth/prec.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk', 'mix_panel'],
        liveryMaterials: ['mix_panel', 'shell'],
      });
      await writeSource(work, 'prec.glb', [bodyParts(), wheelParts(), markerParts()], '-z');
      const result = runBuild(work, ['prec']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'prec.glb'));
      const nodes = sceneNodes(doc);
      const body = nodes.get('body');
      if (!body) throw new Error('missing body');
      const liveryPrims = (body.getMesh()?.listPrimitives() ?? []).filter(
        (p) => p.getMaterial()?.getName() === 'livery',
      );
      expect(liveryPrims).toHaveLength(1);
      expect(primTriangles(liveryPrims[0])).toBe(24);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name}`);
        let tris = 0;
        for (const prim of node.getMesh()?.listPrimitives() ?? []) tris += primTriangles(prim);
        expect(tris, name).toBe(12);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST6: wheel materials named tyre or rubber become tyre, the rest rim, keeping colours', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'tr', {
        source: 'assets/vendor/synth/tr.glb',
        forward: '-z',
        wheelMaterials: ['grip', 'shiny'],
        liveryMaterials: [],
      });
      const innerRim: PartSpec = {
        material: 'SHINY_RIM',
        colour: [0.1, 0.1, 0.8, 1],
        boxes: WHEEL_BOXES.map(([min, max]) => {
          const c: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
          const h: Vec3 = [(max[0] - min[0]) / 4, (max[1] - min[1]) / 4, (max[2] - min[2]) / 4];
          return [
            [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
            [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
          ] as [Vec3, Vec3];
        }),
      };
      await writeSource(
        work,
        'tr.glb',
        [{ material: 'GRIP_RUBBER', colour: [0.8, 0.1, 0.1, 1], boxes: WHEEL_BOXES }, innerRim],
        '-z',
      );
      const result = runBuild(work, ['tr']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'tr.glb'));
      const names = doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .sort();
      expect(names).toEqual(['rim', 'tyre']);
      const tyre = materialColour(doc, 'tyre');
      const rim = materialColour(doc, 'rim');
      expect(tyre[0]).toBeCloseTo(0.8, 5);
      expect(tyre[2]).toBeCloseTo(0.1, 5);
      expect(rim[2]).toBeCloseTo(0.8, 5);
      expect(rim[0]).toBeCloseTo(0.1, 5);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST7: unmatched body materials become body_<n> keeping their colour', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'bodyn', {
        source: 'assets/vendor/synth/bodyn.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['nothing'],
      });
      await writeSource(
        work,
        'bodyn.glb',
        [
          { material: 'PANEL_A', colour: [0, 0.6, 0, 1], boxes: [BODY_BOX] },
          {
            material: 'PANEL_B',
            colour: [0, 0, 0.6, 1],
            boxes: [MARKER_BOX],
          },
          wheelParts(),
        ],
        '-z',
      );
      const result = runBuild(work, ['bodyn']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'bodyn.glb'));
      const names = doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .sort();
      expect(names).toEqual(['body_0', 'body_1', 'tyre']);
      const c0 = materialColour(doc, 'body_0');
      const c1 = materialColour(doc, 'body_1');
      expect(c0[1]).toBeCloseTo(0.6, 5);
      expect(c0[2]).toBeCloseTo(0, 5);
      expect(c1[2]).toBeCloseTo(0.6, 5);
      expect(c1[1]).toBeCloseTo(0, 5);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST8: outGlb and outJson from the config are honoured', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'paths', {
        source: 'assets/vendor/synth/paths.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
        outGlb: 'custom/out/car-x.glb',
        outJson: 'custom/out/car-x.json',
      });
      await writeSource(work, 'paths.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['paths']);
      expect(result.status).toBe(0);
      expect(existsSync(join(work, 'custom', 'out', 'car-x.glb'))).toBe(true);
      expect(existsSync(join(work, 'custom', 'out', 'car-x.json'))).toBe(true);
      expect(existsSync(join(work, 'public', 'models', 'paths.glb'))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST9: a zero triangle budget fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'tiny', {
        source: 'assets/vendor/synth/tiny.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
        triBudget: 0,
      });
      await writeSource(work, 'tiny.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['tiny']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST10: a config whose wheel patterns match nothing fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'nowheel', {
        source: 'assets/vendor/synth/nowheel.glb',
        forward: '-z',
        wheelMaterials: ['zzz_none'],
        liveryMaterials: ['shell'],
      });
      await writeSource(work, 'nowheel.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['nowheel']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('no wheel geometry');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST11: every gt3 wheel keeps at least 24 radial tread segments', async () => {
    for (const id of GT3_IDS) {
      const doc = await readDocAt(join(MODELS, `${id}.glb`));
      const nodes = sceneNodes(doc);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name} in ${id}`);
        expect(radialSegments(node), `${id} ${name}`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it('POST12: gt3 nodes are translation-only with the body at the origin', async () => {
    for (const id of GT3_IDS) {
      const doc = await readDocAt(join(MODELS, `${id}.glb`));
      const nodes = sceneNodes(doc);
      for (const name of ['body', ...WHEEL_NODE_NAMES]) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name} in ${id}`);
        expect(node.listChildren(), `${id} ${name}`).toHaveLength(0);
        expect(node.getScale()[0]).toBeCloseTo(1, 6);
        expect(node.getScale()[1]).toBeCloseTo(1, 6);
        expect(node.getScale()[2]).toBeCloseTo(1, 6);
        const r = node.getRotation();
        expect(r[0]).toBeCloseTo(0, 6);
        expect(r[1]).toBeCloseTo(0, 6);
        expect(r[2]).toBeCloseTo(0, 6);
        expect(r[3]).toBeCloseTo(1, 6);
      }
      const body = nodes.get('body');
      if (!body) throw new Error(`missing body in ${id}`);
      expect(body.getTranslation()[0]).toBeCloseTo(0, 6);
      expect(body.getTranslation()[1]).toBeCloseTo(0, 6);
      expect(body.getTranslation()[2]).toBeCloseTo(0, 6);
    }
  });

  it('POST13: gt3 primitives are triangles with only POSITION, NORMAL and indices', async () => {
    for (const id of GT3_IDS) {
      const doc = await readDocAt(join(MODELS, `${id}.glb`));
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          expect(prim.getMode(), `${id} ${mesh.getName()}`).toBe(4);
          expect(prim.listAttributes()).toHaveLength(2);
          expect(prim.getAttribute('POSITION')).toBeTruthy();
          expect(prim.getAttribute('NORMAL')).toBeTruthy();
          expect(prim.getAttribute('TEXCOORD_0')).toBeNull();
          expect(prim.getIndices()).toBeTruthy();
        }
      }
    }
  });

  it('POST14: gt3 vertex data is finite, indices are in range and normals are unit length', async () => {
    for (const id of GT3_IDS) {
      const doc = await readDocAt(join(MODELS, `${id}.glb`));
      let bad = 0;
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          const nrm = prim.getAttribute('NORMAL');
          const idx = prim.getIndices();
          if (!pos || !nrm || !idx) throw new Error(`incomplete primitive in ${id}`);
          if (idx.getCount() % 3 !== 0) bad++;
          const count = pos.getCount();
          const ia = idx.getArray() as Uint16Array | Uint32Array;
          for (let i = 0; i < ia.length; i++) if (ia[i] >= count) bad++;
          for (const arr of [pos.getArray(), nrm.getArray()] as Float32Array[]) {
            for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) bad++;
          }
          const na = nrm.getArray() as Float32Array;
          for (let i = 0; i < na.length; i += 3) {
            const len = Math.hypot(na[i], na[i + 1], na[i + 2]);
            if (len < 1e-6) continue;
            if (Math.abs(len - 1) > 0.01) bad++;
          }
        }
      }
      expect(bad, id).toBe(0);
    }
  });

  it('POST15: a body material sharing the livery colour does not swallow the livery material', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'twin', {
        source: 'assets/vendor/synth/twin.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      const liveryColour: [number, number, number, number] = [200 / 255, 16 / 255, 46 / 255, 1];
      await writeSource(
        work,
        'twin.glb',
        [
          { material: 'SHELL', colour: liveryColour, boxes: [MARKER_BOX] },
          {
            material: 'TWIN_BODY',
            colour: liveryColour,
            boxes: [
              BODY_BOX,
              [
                [-0.5, 1.1, -0.5],
                [0.5, 1.3, 0.5],
              ] as [Vec3, Vec3],
            ],
          },
          wheelParts(),
        ],
        '-z',
      );
      const result = runBuild(work, ['twin']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'twin.glb'));
      const names = doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName());
      for (const name of names) {
        const ok = name === 'livery' || name === 'tyre' || name === 'rim' || /^body_\d+$/.test(name);
        expect(ok, `material ${name}`).toBe(true);
      }
      const livery = doc
        .getRoot()
        .listMaterials()
        .find((m) => m.getName() === 'livery');
      if (!livery) throw new Error('missing livery material');
      const c = livery.getBaseColorFactor();
      expect(c[0]).toBeCloseTo(200 / 255, 4);
      expect(c[1]).toBeCloseTo(16 / 255, 4);
      expect(c[2]).toBeCloseTo(46 / 255, 4);
      const body = sceneNodes(doc).get('body');
      if (!body) throw new Error('missing body');
      const single = (body.getMesh()?.listPrimitives() ?? []).find((p) => primTriangles(p) === 12);
      if (!single) throw new Error('missing single-box livery primitive');
      expect(single.getMaterial()?.getName()).toBe('livery');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST16: a mesh shared by two nodes is baked per node at each node transform', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'shared', {
        source: 'assets/vendor/synth/shared.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: [],
      });
      const doc = new Document();
      doc.createBuffer();
      const scene = doc.createScene('Scene');
      const shell = doc.createMaterial('SHELL').setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      const shared = doc
        .createMesh('shared')
        .addPrimitive(addPrim(doc, shell, mergeBoxes([[[-0.2, 0.15, -0.2], [0.2, 0.95, 0.2]]])));
      scene.addChild(doc.createNode('a').setMesh(shared).setTranslation([-1.2, 0, 0]));
      scene.addChild(doc.createNode('b').setMesh(shared).setTranslation([1.2, 0, 0]));
      const tyre = doc.createMaterial('TYRE_BLK').setBaseColorFactor([0.05, 0.05, 0.05, 1]);
      scene.addChild(
        doc
          .createNode('wheels')
          .setMesh(doc.createMesh('wheels').addPrimitive(addPrim(doc, tyre, mergeBoxes(WHEEL_BOXES)))),
      );
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'shared.glb'), doc);
      const result = runBuild(work, ['shared']);
      expect(result.status).toBe(0);
      const out = await readDocAt(join(work, 'public', 'models', 'shared.glb'));
      const body = sceneNodes(out).get('body');
      if (!body) throw new Error('missing body');
      const stats = bodyPrimStats(body);
      const verts = stats.reduce((sum, s) => sum + s.verts, 0);
      const minX = Math.min(...stats.map((s) => s.minX));
      const maxX = Math.max(...stats.map((s) => s.maxX));
      expect(maxX).toBeGreaterThan(1.2);
      expect(minX).toBeLessThan(-1.2);
      expect(verts).toBe(16);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST17: a mirrored node keeps triangle winding aligned with the normals', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'mirror', {
        source: 'assets/vendor/synth/mirror.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: [],
      });
      const doc = new Document();
      doc.createBuffer();
      const scene = doc.createScene('Scene');
      const shell = doc.createMaterial('SHELL').setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      const bodyBox = mergeBoxes([
        [
          [0.4, 0.15, -0.2],
          [0.9, 0.95, 0.2],
        ],
      ]);
      scene.addChild(
        doc
          .createNode('mirror-body')
          .setMesh(doc.createMesh('mirror-body').addPrimitive(addPrim(doc, shell, bodyBox)))
          .setScale([-1, 1, 1]),
      );
      const tyre = doc.createMaterial('TYRE_BLK').setBaseColorFactor([0.05, 0.05, 0.05, 1]);
      scene.addChild(
        doc
          .createNode('wheels')
          .setMesh(doc.createMesh('wheels').addPrimitive(addPrim(doc, tyre, mergeBoxes(WHEEL_BOXES)))),
      );
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'mirror.glb'), doc);
      const result = runBuild(work, ['mirror']);
      expect(result.status).toBe(0);
      const out = await readDocAt(join(work, 'public', 'models', 'mirror.glb'));
      const body = sceneNodes(out).get('body');
      if (!body) throw new Error('missing body');
      const stats = bodyPrimStats(body);
      expect(Math.max(...stats.map((s) => s.maxX))).toBeLessThan(0);
      expect(Math.min(...stats.map((s) => s.minX))).toBeLessThan(-0.3);
      expect(windingMismatches(body)).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST18: a primitive that is not TRIANGLES fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'mode', {
        source: 'assets/vendor/synth/mode.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: [],
      });
      const doc = new Document();
      doc.createBuffer();
      const scene = doc.createScene('Scene');
      const shell = doc.createMaterial('SHELL').setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      const tyre = doc.createMaterial('TYRE_BLK').setBaseColorFactor([0.05, 0.05, 0.05, 1]);
      scene.addChild(
        doc
          .createNode('body')
          .setMesh(doc.createMesh('body').addPrimitive(addPrim(doc, shell, mergeBoxes([BODY_BOX]), { mode: 0 }))),
      );
      scene.addChild(
        doc
          .createNode('wheels')
          .setMesh(doc.createMesh('wheels').addPrimitive(addPrim(doc, tyre, mergeBoxes(WHEEL_BOXES)))),
      );
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'mode.glb'), doc);
      const result = runBuild(work, ['mode']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('not TRIANGLES');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST19: a primitive without NORMAL fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'nonrm', {
        source: 'assets/vendor/synth/nonrm.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: [],
      });
      const doc = new Document();
      doc.createBuffer();
      const scene = doc.createScene('Scene');
      const shell = doc.createMaterial('SHELL').setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      const tyre = doc.createMaterial('TYRE_BLK').setBaseColorFactor([0.05, 0.05, 0.05, 1]);
      scene.addChild(
        doc
          .createNode('body')
          .setMesh(
            doc
              .createMesh('body')
              .addPrimitive(addPrim(doc, shell, mergeBoxes([BODY_BOX]), { normals: false })),
          ),
      );
      scene.addChild(
        doc
          .createNode('wheels')
          .setMesh(doc.createMesh('wheels').addPrimitive(addPrim(doc, tyre, mergeBoxes(WHEEL_BOXES)))),
      );
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'nonrm.glb'), doc);
      const result = runBuild(work, ['nonrm']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('missing');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST20: wheel geometry missing in one corner fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'corner', {
        source: 'assets/vendor/synth/corner.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      const cornerBoxes: [Vec3, Vec3][] = [
        [
          [-1.15, 0, -2.15],
          [-0.85, 0.3, -1.85],
        ],
        [
          [-1.15, 0, 1.85],
          [-0.85, 0.3, 2.15],
        ],
        [
          [0.85, 0, 1.85],
          [1.15, 0.3, 2.15],
        ],
      ];
      await writeSource(
        work,
        'corner.glb',
        [bodyParts(), { material: 'TYRE_BLK', colour: [0.05, 0.05, 0.05, 1], boxes: cornerBoxes }],
        '-z',
      );
      const result = runBuild(work, ['corner']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('no wheel geometry for');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST21: a source with no length along z fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'flat', {
        source: 'assets/vendor/synth/flat.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      await writeSource(
        work,
        'flat.glb',
        [
          {
            material: 'SHELL',
            colour: [0.5, 0.5, 0.5, 1],
            boxes: [
              [
                [-1, 0, 0],
                [1, 1, 0],
              ] as [Vec3, Vec3],
            ],
          },
        ],
        '-z',
      );
      const result = runBuild(work, ['flat']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('no length along z');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST22: the CLI builds only the ids given as arguments', async () => {
    const work = sandbox();
    try {
      for (const id of ['alpha', 'beta', 'gamma']) {
        writeConfig(work, id, {
          source: 'assets/vendor/synth/multi.glb',
          forward: '-z',
          wheelMaterials: ['tyre_blk'],
          liveryMaterials: ['shell'],
        });
      }
      await writeSource(work, 'multi.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['gamma', 'alpha']);
      expect(result.status).toBe(0);
      expect(existsSync(join(work, 'public', 'models', 'alpha.glb'))).toBe(true);
      expect(existsSync(join(work, 'public', 'models', 'gamma.glb'))).toBe(true);
      expect(existsSync(join(work, 'public', 'models', 'beta.glb'))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST23: an unreadable source file fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'broken', {
        source: 'assets/vendor/synth/broken.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      writeFileSync(join(work, 'assets', 'vendor', 'synth', 'broken.glb'), 'not a glb');
      const result = runBuild(work, ['broken']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST24: buildCar for f4 writes to the outGlb and outJson from its config', () => {
    const work = f4Sandbox();
    try {
      editConfig(work, 'f4', { outGlb: 'custom/f4x.glb', outJson: 'custom/f4x.json' });
      const result = runBuild(work, ['f4']);
      expect(result.status).toBe(0);
      expect(existsSync(join(work, 'custom', 'f4x.glb'))).toBe(true);
      expect(existsSync(join(work, 'custom', 'f4x.json'))).toBe(true);
      expect(existsSync(join(work, 'public', 'models', 'f4.glb'))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 600000);

  it('POST25: buildCar for f4 fails when the config triangle budget is below the output', () => {
    const work = f4Sandbox();
    try {
      editConfig(work, 'f4', { triBudget: 1000 });
      const result = runBuild(work, ['f4']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('triangle budget exceeded');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 600000);

  it('POST26: a source with no meshes fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'empty', {
        source: 'assets/vendor/synth/empty.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      const doc = new Document();
      doc.createBuffer();
      doc.createScene('Scene');
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'empty.glb'), doc);
      const result = runBuild(work, ['empty']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('no length along z');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST27: a primitive without a material fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'nomat', {
        source: 'assets/vendor/synth/nomat.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      const doc = new Document();
      const buffer = doc.createBuffer();
      const scene = doc.createScene('Scene');
      const bare = addPrim(doc, doc.createMaterial('TMP').setBaseColorFactor([1, 1, 1, 1]), mergeBoxes([BODY_BOX]));
      bare.setMaterial(null);
      scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(bare)));
      const tyre = doc.createMaterial('TYRE_BLK').setBaseColorFactor([0.05, 0.05, 0.05, 1]);
      scene.addChild(
        doc
          .createNode('wheels')
          .setMesh(doc.createMesh('wheels').addPrimitive(addPrim(doc, tyre, mergeBoxes(WHEEL_BOXES)))),
      );
      void buffer;
      await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', 'nomat.glb'), doc);
      const result = runBuild(work, ['nomat']);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('unmapped material');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST28: the body absorbs simplification while the wheels keep their triangles', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'dense', {
        source: 'assets/vendor/synth/dense.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
        triBudget: 200,
      });
      const boxes: [Vec3, Vec3][] = [];
      for (let i = 0; i < 40; i++) {
        boxes.push([
          [-0.8, 0.15 + i * 0.01, -2.2 + i * 0.02],
          [0.8, 0.16 + i * 0.01, -2.15 + i * 0.02],
        ]);
      }
      await writeSource(
        work,
        'dense.glb',
        [
          { material: 'SHELL', colour: [0.5, 0.5, 0.5, 1], boxes },
          wheelParts(),
        ],
        '-z',
      );
      const result = runBuild(work, ['dense']);
      expect(result.status).toBe(0);
      const out = await readDocAt(join(work, 'public', 'models', 'dense.glb'));
      const nodes = sceneNodes(out);
      let total = 0;
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name}`);
        const tris = nodeTriangles(node);
        expect(tris, name).toBe(12);
        total += tris;
      }
      const body = nodes.get('body');
      if (!body) throw new Error('missing body');
      const bodyTris = nodeTriangles(body);
      expect(bodyTris).toBeLessThan(40 * 12);
      total += bodyTris;
      expect(total).toBeLessThanOrEqual(200);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST29: a zero targetLength fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'zero', {
        source: 'assets/vendor/synth/zero.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
        targetLength: 0,
      });
      await writeSource(work, 'zero.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['zero']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST30: a negative targetLength fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'neg', {
        source: 'assets/vendor/synth/neg.glb',
        forward: '-z',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
        targetLength: -4,
      });
      await writeSource(work, 'neg.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['neg']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST31: an unknown forward axis fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'axis', {
        source: 'assets/vendor/synth/axis.glb',
        forward: 'up',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      await writeSource(work, 'axis.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['axis']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST32: the lowest wheel vertex of every output sits on the ground', async () => {
    for (const id of ['f4', ...GT3_IDS]) {
      const doc = await readDocAt(join(MODELS, `${id}.glb`));
      const nodes = sceneNodes(doc);
      let lowest = Infinity;
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name} in ${id}`);
        lowest = Math.min(lowest, getBounds(node).min[1]);
      }
      expect(Math.abs(lowest), id).toBeLessThanOrEqual(0.01);
    }
  });

  it('POST33: a config without a forward axis fails the build', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'nofwd', {
        source: 'assets/vendor/synth/nofwd.glb',
        wheelMaterials: ['tyre_blk'],
        liveryMaterials: ['shell'],
      });
      await writeSource(work, 'nofwd.glb', [bodyParts(), wheelParts()], '-z');
      const result = runBuild(work, ['nofwd']);
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);

  it('POST34: a wheel with no tyre-classified material still gets its radius from the geometry', async () => {
    const work = sandbox();
    try {
      writeConfig(work, 'rimonly', {
        source: 'assets/vendor/synth/rimonly.glb',
        forward: '-z',
        wheelMaterials: ['shiny'],
        liveryMaterials: ['shell'],
      });
      await writeSource(
        work,
        'rimonly.glb',
        [bodyParts(), { material: 'SHINY_RIM', colour: [0.1, 0.1, 0.8, 1], boxes: WHEEL_BOXES }],
        '-z',
      );
      const result = runBuild(work, ['rimonly']);
      expect(result.status).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'rimonly.glb'));
      const names = doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .sort();
      expect(names).toEqual(['rim', 'livery'].sort());
      const meta = readMetaAt(join(work, 'public', 'models', 'rimonly.json'));
      expect(meta.wheelRadius).toBeCloseTo(0.33, 2);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60000);
});

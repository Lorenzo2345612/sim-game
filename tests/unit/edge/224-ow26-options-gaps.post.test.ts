import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import type { Material, Node, Primitive } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

interface Geom {
  position: number[];
  normal: number[];
  index: number[];
}

interface PartSpec {
  node: string;
  material: string;
  colour: Rgba;
  boxes?: [Vec3, Vec3][];
  geoms?: Geom[];
  texture?: { name: string; width: number; height: number; rgba: Rgba };
  extra?: Partial<Record<'mr' | 'nrm' | 'occ' | 'emi', { name: string; width: number; height: number; rgba: Rgba }>>;
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
const GREY: Rgba = [0.5, 0.5, 0.5, 1];
const BLUE: Rgba = [0.1, 0.1, 0.8, 1];

function planeGeom(box: [Vec3, Vec3], n: number): Geom {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      position.push(box[0][0], box[0][1] + ((box[1][1] - box[0][1]) * j) / n, box[0][2] + ((box[1][2] - box[0][2]) * i) / n);
      normal.push(-1, 0, 0);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  return { position, normal, index };
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(width: number, height: number, rgba: Rgba): Buffer {
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 4;
      raw[o] = rgba[0];
      raw[o + 1] = rgba[1];
      raw[o + 2] = rgba[2];
      raw[o + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function boxGeom(min: Vec3, max: Vec3): Geom {
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
      position.push(...corner(ci));
      normal.push(...n);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position, normal, index };
}

function partGeom(part: PartSpec): Geom {
  const list = part.geoms ?? (part.boxes ?? []).map(([min, max]) => boxGeom(min, max));
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const g of list) {
    const base = position.length / 3;
    position.push(...g.position);
    normal.push(...g.normal);
    for (const v of g.index) index.push(v + base);
  }
  return { position, normal, index };
}

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildCar-224g-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

function attachTexture(doc: Document, material: Material, tex: PartSpec['texture']): void {
  if (!tex) return;
  material.setBaseColorTexture(doc.createTexture(tex.name).setImage(solidPng(tex.width, tex.height, tex.rgba)));
}

function addPrim(doc: Document, material: Material, geom: Geom): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  prim.setMaterial(material);
  prim.setAttribute(
    'POSITION',
    doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(geom.position)),
  );
  prim.setAttribute(
    'NORMAL',
    doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(geom.normal)),
  );
  prim.setIndices(
    doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(geom.index)),
  );
  return prim;
}

async function writeSource(work: string, name: string, parts: PartSpec[]): Promise<void> {
  const doc = new Document();
  const scene = doc.createScene('Scene');
  for (const part of parts) {
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    attachTexture(doc, material, part.texture);
    for (const slot of ['mr', 'nrm', 'occ', 'emi'] as const) {
      const tex = part.extra?.[slot];
      if (!tex) continue;
      const t = doc.createTexture(tex.name).setImage(solidPng(tex.width, tex.height, tex.rgba));
      if (slot === 'mr') material.setMetallicRoughnessTexture(t);
      if (slot === 'nrm') material.setNormalTexture(t);
      if (slot === 'occ') material.setOcclusionTexture(t);
      if (slot === 'emi') material.setEmissiveTexture(t);
    }
    const mesh = doc.createMesh(part.material).addPrimitive(addPrim(doc, material, partGeom(part)));
    const node: Node = doc.createNode(part.node).setMesh(mesh);
    scene.addChild(node);
  }
  await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', name), doc);
}

function writeConfig(work: string, id: string, cfg: Record<string, unknown>): void {
  const full = {
    targetLength: 4,
    triBudget: 10000,
    outGlb: `public/models/${id}.glb`,
    outJson: `public/models/${id}.json`,
    forward: '-z',
    liveryMaterials: [],
    wheelMaterials: ['wheelbox', 'rubber'],
    ...cfg,
  };
  writeFileSync(join(work, 'assets', 'cars', `${id}.pipeline.json`), `${JSON.stringify(full, null, 2)}\n`);
}

function runBuild(work: string, id: string): { status: number; output: string } {
  try {
    const output = execFileSync(TSX, ['tools/assets/buildCar.ts', id], {
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

async function build(
  work: string,
  id: string,
  parts: PartSpec[],
  cfg: Record<string, unknown>,
): Promise<{ status: number; output: string }> {
  await writeSource(work, `${id}.glb`, parts);
  writeConfig(work, id, { source: `assets/vendor/synth/${id}.glb`, ...cfg });
  return runBuild(work, id);
}

function bodyMaterial(doc: Document, rgba: Rgba): Material {
  const hit = doc
    .getRoot()
    .listMaterials()
    .find((m) => /^body_\d+$/.test(m.getName()) && rgba.every((v, i) => Math.abs(m.getBaseColorFactor()[i] - v) < 1e-3));
  if (!hit) throw new Error('missing body material');
  return hit;
}

function nodeTris(doc: Document, name: string): number {
  const node = doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .find((n) => n.getName() === name);
  if (!node) throw new Error(`missing node ${name}`);
  let tris = 0;
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    tris += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
  }
  return tris;
}

function wheelTris(doc: Document): number {
  return ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'].reduce(
    (sum, name) => sum + nodeTris(doc, name),
    0,
  );
}

function allTextureSlots(m: Material): unknown[] {
  return [
    m.getBaseColorTexture(),
    m.getMetallicRoughnessTexture(),
    m.getNormalTexture(),
    m.getOcclusionTexture(),
    m.getEmissiveTexture(),
  ];
}

function texturedShell(): PartSpec {
  return {
    node: 'shell',
    material: 'shell_mat',
    colour: GREY,
    boxes: [BODY_BOX],
    texture: { name: 'shell_base', width: 8, height: 8, rgba: BLUE },
    extra: {
      mr: { name: 'shell_mr', width: 8, height: 8, rgba: BLUE },
      nrm: { name: 'shell_nrm', width: 8, height: 8, rgba: BLUE },
      occ: { name: 'shell_occ', width: 8, height: 8, rgba: BLUE },
      emi: { name: 'shell_emi', width: 8, height: 8, rgba: BLUE },
    },
  };
}

function wheelPlanes(n: number): PartSpec {
  return { node: 'wheels', material: 'wheelbox', colour: BLUE, geoms: WHEEL_BOXES.map((b) => planeGeom(b, n)) };
}

function readDocAt(path: string): Promise<Document> {
  return new NodeIO().read(path);
}

describe('224 buildCar option post-code gaps', () => {
  it('GAP1: an absent or empty neutralMaterials list keeps every texture slot', async () => {
    const work = sandbox();
    try {
      const parts = [texturedShell(), wheelPlanes(2)];
      for (const [id, cfg] of [
        ['absent', {}],
        ['empty', { neutralMaterials: [] }],
      ] as [string, Record<string, unknown>][]) {
        const result = await build(work, id, parts, { maxTextureSize: 32, ...cfg });
        expect(result.status, `${id} ${result.output}`).toBe(0);
        const doc = await readDocAt(join(work, 'public', 'models', `${id}.glb`));
        const slots = allTextureSlots(bodyMaterial(doc, GREY));
        slots.forEach((slot, i) => expect(slot, `${id} slot ${i}`).not.toBeNull());
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 240000);

  it('GAP2: a wheelTriBudget at the wheel triangle count leaves the wheels untouched', async () => {
    const work = sandbox();
    try {
      const parts = [
        { node: 'shell', material: 'shell_mat', colour: GREY, geoms: [planeGeom(BODY_BOX, 20)] },
        wheelPlanes(4),
      ];
      const reference = await build(work, 'reference', parts, { triBudget: 10000 });
      expect(reference.status, reference.output).toBe(0);
      const full = wheelTris(await readDocAt(join(work, 'public', 'models', 'reference.glb')));
      expect(full).toBeGreaterThan(0);
      const equal = await build(work, 'equal', parts, { triBudget: 200, wheelTriBudget: full });
      expect(equal.status, equal.output).toBe(0);
      const equalDoc = await readDocAt(join(work, 'public', 'models', 'equal.glb'));
      expect(wheelTris(equalDoc)).toBe(full);
      expect(nodeTris(equalDoc, 'body')).toBeLessThan(nodeTris(await readDocAt(join(work, 'public', 'models', 'reference.glb')), 'body'));
      const cap = Math.floor(full / 4);
      const lower = await build(work, 'lower', parts, { triBudget: 200, wheelTriBudget: cap });
      expect(lower.status, lower.output).toBe(0);
      expect(wheelTris(await readDocAt(join(work, 'public', 'models', 'lower.glb')))).toBeLessThanOrEqual(cap);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 360000);
});

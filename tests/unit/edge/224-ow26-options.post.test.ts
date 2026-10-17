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
import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import type { Material, Mesh, Node, Primitive } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';

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
  parent?: string;
  sharedFrom?: string;
  texture?: { name: string; width: number; height: number; rgba: Rgba };
  extra?: Partial<Record<'mr' | 'nrm' | 'occ' | 'emi', { name: string; width: number; height: number; rgba: Rgba }>>;
  transform?: boolean;
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
const PROBE_BOX: [Vec3, Vec3] = [
  [-0.3, 0.95, -0.5],
  [0.3, 1.05, 0.5],
];
const GREY: Rgba = [0.5, 0.5, 0.5, 1];
const RED: Rgba = [0.8, 0.1, 0.1, 1];
const BLUE: Rgba = [0.1, 0.1, 0.8, 1];

/** Flat n x n quad grid on the -x face of the box: coplanar, so meshopt can collapse it. */
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

function boxGeom(min: Vec3, max: Vec3): { position: number[]; normal: number[]; index: number[] } {
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

function mergeBoxes(boxes: [Vec3, Vec3][]): Geom {
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  for (const [min, max] of boxes) {
    const g = boxGeom(min, max);
    const base = position.length / 3;
    position.push(...g.position);
    normal.push(...g.normal);
    for (const v of g.index) index.push(v + base);
  }
  return { position, normal, index };
}

function partGeom(part: PartSpec): Geom {
  const list = part.geoms ?? [mergeBoxes(part.boxes ?? [])];
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
  const work = mkdtempSync(join(tmpdir(), 'buildCar-224p-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

function attachTexture(doc: Document, material: Material, tex: PartSpec['texture'], transform: boolean): void {
  if (!tex) return;
  const texture = doc.createTexture(tex.name).setImage(solidPng(tex.width, tex.height, tex.rgba));
  material.setBaseColorTexture(texture);
  if (!transform) return;
  const ext = doc.createExtension(KHRTextureTransform);
  material
    .getBaseColorTextureInfo()
    ?.setExtension('KHRTextureTransform', ext.createTransform().setOffset([0.25, 0.25]));
}

function addPrim(doc: Document, material: Material, geom: { position: number[]; normal: number[]; index: number[] }): Primitive {
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
  const groups = new Map<string, Node>();
  const meshes = new Map<string, Mesh>();
  const groupOf = (label: string): Node => {
    const hit = groups.get(label);
    if (hit) return hit;
    const node = doc.createNode(label);
    scene.addChild(node);
    groups.set(label, node);
    return node;
  };
  for (const part of parts) {
    if (part.sharedFrom) {
      const mesh = meshes.get(part.sharedFrom);
      if (!mesh) throw new Error(`missing shared mesh ${part.sharedFrom}`);
      (part.parent ? groupOf(part.parent) : scene).addChild(doc.createNode(part.node).setMesh(mesh));
      continue;
    }
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    if (part.texture) attachTexture(doc, material, part.texture, part.transform ?? false);
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
    meshes.set(part.node, mesh);
    (part.parent ? groupOf(part.parent) : scene).addChild(doc.createNode(part.node).setMesh(mesh));
  }
  await new NodeIO().write(join(work, 'assets', 'vendor', 'synth', name), doc);
}

/** Two nodes share one mesh so dropNodes must not dispose it for the surviving node. */
async function writeSharedMeshSource(work: string, name: string, dropName: string, keepName: string): Promise<void> {
  await writeSource(work, name, [
    { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
    wheelParts(),
    { node: dropName, material: 'shared_mat', colour: RED, boxes: [PROBE_BOX] },
    { node: keepName, material: 'shared_mat', colour: RED, sharedFrom: dropName },
  ]);
}

function requireExtension(glbPath: string, ext: string): void {
  const buf = readFileSync(glbPath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    extensionsUsed?: string[];
    extensionsRequired?: string[];
  };
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), ext])];
  if (!json.extensionsUsed?.includes(ext)) json.extensionsUsed = [...(json.extensionsUsed ?? []), ext];
  const chunk = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (chunk.length % 4)) % 4;
  const padded = pad > 0 ? Buffer.concat([chunk, Buffer.alloc(pad, 0x20)]) : chunk;
  const rest = buf.subarray(20 + jsonLen);
  const total = 12 + 8 + padded.length + rest.length;
  const out = Buffer.alloc(total);
  buf.copy(out, 0, 0, 20);
  out.writeUInt32LE(padded.length, 12);
  padded.copy(out, 20);
  rest.copy(out, 20 + padded.length);
  writeFileSync(glbPath, out);
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

async function build(work: string, id: string, parts: PartSpec[], cfg: Record<string, unknown>): Promise<{ status: number; output: string }> {
  await writeSource(work, `${id}.glb`, parts);
  writeConfig(work, id, { source: `assets/vendor/synth/${id}.glb`, ...cfg });
  return runBuild(work, id);
}

function readDocAt(path: string): Promise<Document> {
  return new NodeIO().read(path);
}

function bodyMaterials(doc: Document): Material[] {
  return doc
    .getRoot()
    .listMaterials()
    .filter((m) => /^body_\d+$/.test(m.getName()));
}

function isColour(m: Material, rgba: Rgba): boolean {
  const f = m.getBaseColorFactor();
  return rgba.every((v, i) => Math.abs(f[i] - v) < 1e-3);
}

function bodyMaxY(doc: Document): number {
  const node = doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .find((n) => n.getName() === 'body');
  if (!node) throw new Error('missing body');
  let max = -Infinity;
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const pos = prim.getAttribute('POSITION');
    const arr = pos?.getArray() as Float32Array;
    for (let i = 1; i < arr.length; i += 3) if (arr[i] > max) max = arr[i];
  }
  return max;
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

/** Counts each wheel mesh once: identical wheels may share one mesh after dedup. */
function wheelTris(doc: Document): number {
  const nodes = new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n]));
  const seen = new Set<unknown>();
  let sum = 0;
  for (const name of ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right']) {
    const mesh = nodes.get(name)?.getMesh();
    if (!mesh || seen.has(mesh)) continue;
    seen.add(mesh);
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      sum += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
    }
  }
  return sum;
}

function hasTextures(m: Material): boolean {
  return !!(
    m.getBaseColorTexture() ||
    m.getMetallicRoughnessTexture() ||
    m.getNormalTexture() ||
    m.getOcclusionTexture() ||
    m.getEmissiveTexture()
  );
}

function wheelParts(boxes: [Vec3, Vec3][] = WHEEL_BOXES): PartSpec {
  return { node: 'wheels', material: 'wheelbox', colour: BLUE, boxes };
}

function wheelPlaneParts(n: number): PartSpec {
  return { node: 'wheels', material: 'wheelbox', colour: BLUE, geoms: WHEEL_BOXES.map((b) => planeGeom(b, n)) };
}

function probePart(): PartSpec {
  return { node: 'probe', material: 'probe_mat', colour: RED, boxes: [PROBE_BOX] };
}

describe('224 buildCar option gaps', () => {
  it('POST1: a node listed in dropNodes contributes no geometry to the output', async () => {
    const work = sandbox();
    try {
      const parts = [
        { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
        wheelParts(),
        probePart(),
      ];
      const kept = await build(work, 'keep', parts, {});
      expect(kept.status, kept.output).toBe(0);
      const dropped = await build(work, 'drop', parts, { dropNodes: ['probe'] });
      expect(dropped.status, dropped.output).toBe(0);
      const keepDoc = await readDocAt(join(work, 'public', 'models', 'keep.glb'));
      const dropDoc = await readDocAt(join(work, 'public', 'models', 'drop.glb'));
      expect(bodyMaxY(keepDoc)).toBeCloseTo(1.05, 3);
      expect(bodyMaxY(dropDoc)).toBeCloseTo(0.95, 3);
      expect(bodyMaterials(dropDoc).some((m) => isColour(m, RED))).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST2: an empty or absent dropNodes list keeps every node', async () => {
    const work = sandbox();
    try {
      const parts = [
        { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX], parent: 'grp' },
        wheelParts(),
        probePart(),
      ];
      for (const [id, cfg] of [
        ['absent', {}],
        ['empty', { dropNodes: [] }],
        ['unknown', { dropNodes: ['no_such_node'] }],
        ['nomesh', { dropNodes: ['grp'] }],
      ] as [string, Record<string, unknown>][]) {
        const result = await build(work, id, parts, cfg);
        expect(result.status, `${id} ${result.output}`).toBe(0);
        const doc = await readDocAt(join(work, 'public', 'models', `${id}.glb`));
        expect(bodyMaxY(doc), id).toBeCloseTo(1.05, 3);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 240000);

  it('POST3: a mesh shared by a dropped and a kept node stays for the kept node', async () => {
    const work = sandbox();
    try {
      await writeSharedMeshSource(work, 'shared.glb', 'shared_drop', 'shared_keep');
      writeConfig(work, 'shared', {
        source: 'assets/vendor/synth/shared.glb',
        dropNodes: ['shared_drop'],
      });
      const result = runBuild(work, 'shared');
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'shared.glb'));
      expect(bodyMaxY(doc)).toBeCloseTo(1.05, 3);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST4: neutralMaterials drops every texture slot of the match and keeps its colour', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'neutral',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { name: 'shell_tex', width: 8, height: 8, rgba: BLUE },
            extra: {
              mr: { name: 'shell_mr', width: 8, height: 8, rgba: RED },
              nrm: { name: 'shell_nrm', width: 8, height: 8, rgba: BLUE },
              occ: { name: 'shell_occ', width: 8, height: 8, rgba: RED },
              emi: { name: 'shell_emi', width: 8, height: 8, rgba: BLUE },
            },
          },
          {
            node: 'probe',
            material: 'decal_panel',
            colour: RED,
            boxes: [PROBE_BOX],
            texture: { name: 'decal_tex', width: 8, height: 8, rgba: GREY },
            extra: { mr: { name: 'decal_mr', width: 8, height: 8, rgba: GREY } },
          },
          wheelParts(),
        ],
        { neutralMaterials: ['DECAL'], maxTextureSize: 32 },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'neutral.glb'));
      const neutralised = bodyMaterials(doc).find((m) => isColour(m, RED));
      const kept = bodyMaterials(doc).find((m) => isColour(m, GREY));
      if (!neutralised || !kept) throw new Error('missing body materials');
      expect(hasTextures(neutralised), 'neutralised material').toBe(false);
      expect(isColour(neutralised, RED)).toBe(true);
      expect(kept.getBaseColorTexture(), 'kept baseColor').not.toBeNull();
      expect(kept.getMetallicRoughnessTexture(), 'kept mr').not.toBeNull();
      expect(kept.getNormalTexture(), 'kept nrm').not.toBeNull();
      expect(kept.getOcclusionTexture(), 'kept occ').not.toBeNull();
      expect(kept.getEmissiveTexture(), 'kept emi').not.toBeNull();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST5: wheelTriBudget caps the wheels before the body gives up triangles', async () => {
    const work = sandbox();
    try {
      const parts = [
        { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
        wheelPlaneParts(16),
      ];
      const cfg = { triBudget: 2000 };
      const capped = await build(work, 'capped', parts, { ...cfg, wheelTriBudget: 512 });
      expect(capped.status, capped.output).toBe(0);
      const plain = await build(work, 'plain', parts, cfg);
      expect(plain.status, plain.output).toBe(0);
      const cappedDoc = await readDocAt(join(work, 'public', 'models', 'capped.glb'));
      const plainDoc = await readDocAt(join(work, 'public', 'models', 'plain.glb'));
      expect(wheelTris(cappedDoc)).toBeLessThanOrEqual(512);
      expect(wheelTris(cappedDoc)).toBeLessThan(wheelTris(plainDoc));
      expect(nodeTris(cappedDoc, 'body')).toBe(12);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 240000);

  it('POST6: wheelTriBudget is ignored while the model is inside the triangle budget', async () => {
    const work = sandbox();
    try {
      const parts = [
        { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
        wheelPlaneParts(16),
      ];
      const inside = await build(work, 'inside', parts, { triBudget: 10000, wheelTriBudget: 512 });
      expect(inside.status, inside.output).toBe(0);
      const base = await build(work, 'base', parts, { triBudget: 10000 });
      expect(base.status, base.output).toBe(0);
      const insideDoc = await readDocAt(join(work, 'public', 'models', 'inside.glb'));
      const baseDoc = await readDocAt(join(work, 'public', 'models', 'base.glb'));
      expect(wheelTris(insideDoc)).toBe(wheelTris(baseDoc));
      expect(wheelTris(insideDoc)).toBeGreaterThan(512);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 240000);

  it('POST7: a source that requires KHR_texture_transform still builds and keeps the texture', async () => {
    const work = sandbox();
    try {
      await writeSource(work, 'tt.glb', [
        {
          node: 'shell',
          material: 'shell_mat',
          colour: GREY,
          boxes: [BODY_BOX],
          texture: { name: 'tt', width: 8, height: 8, rgba: RED },
          transform: true,
        },
        wheelParts(),
      ]);
      requireExtension(join(work, 'assets', 'vendor', 'synth', 'tt.glb'), 'KHR_texture_transform');
      writeConfig(work, 'tt', {
        source: 'assets/vendor/synth/tt.glb',
        maxTextureSize: 32,
      });
      const result = runBuild(work, 'tt');
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'tt.glb'));
      const body = bodyMaterials(doc).find((m) => isColour(m, GREY));
      if (!body) throw new Error('missing body material');
      expect(body.getBaseColorTexture()).not.toBeNull();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST8: a zero wheelTriBudget still leaves every wheel with geometry', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'zero',
        [
          { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
          wheelPlaneParts(16),
        ],
        { triBudget: 2000, wheelTriBudget: 0 },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'zero.glb'));
      for (const name of ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right']) {
        expect(nodeTris(doc, name), name).toBeGreaterThan(0);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST9: a negative wheelTriBudget fails the build', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'neg',
        [
          { node: 'shell', material: 'shell_mat', colour: GREY, boxes: [BODY_BOX] },
          wheelPlaneParts(16),
        ],
        { triBudget: 2000, wheelTriBudget: -1 },
      );
      expect(result.status).not.toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);
});

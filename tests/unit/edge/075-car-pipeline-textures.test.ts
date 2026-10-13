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
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import type { Node as GltfNode, Primitive } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

interface PartSpec {
  node: string;
  material: string;
  colour: Rgba;
  boxes: [Vec3, Vec3][];
  texture?: { name: string; size: number; rgba: Rgba };
}

const BODY_BOX: [Vec3, Vec3] = [
  [-0.8, 0.15, -2.2],
  [0.8, 0.95, 1.8],
];
const MARKER_BOX: [Vec3, Vec3] = [
  [-0.3, 0.95, -0.5],
  [0.3, 1.05, 0.5],
];
const BIG_WHEEL_BOXES: [Vec3, Vec3][] = [
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
const BIG_SUFFIXES = ['25', '26', '28', '29'];
const SMALL_SUFFIXES = ['68', '69', '70', '71'];
const WHEEL_NODES = [
  'rim:25',
  'rim:26',
  'rim:28',
  'rim:29',
  'tyre:68',
  'tyre:69',
  'tyre:70',
  'tyre:71',
];
const UNLISTED_BOX: [Vec3, Vec3] = [
  [-3.2, 0.4, -0.2],
  [-2.8, 0.8, 0.2],
];
const CASE_BOX: [Vec3, Vec3] = [
  [2.8, 0.4, -0.2],
  [3.2, 0.8, 0.2],
];
const TEX_EXTRAS = { title: 'Ford Mustang GT3', author: 'MattDoesBlender' };
const BRANDS = ['ford', 'mustang', 'mattdoesblender'];

function centre(box: [Vec3, Vec3]): Vec3 {
  return [
    (box[0][0] + box[1][0]) / 2,
    (box[0][1] + box[1][1]) / 2,
    (box[0][2] + box[1][2]) / 2,
  ];
}

function shrink(box: [Vec3, Vec3], h: Vec3): [Vec3, Vec3] {
  const c = centre(box);
  return [
    [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
    [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
  ];
}

function boxArrays(min: Vec3, max: Vec3): { position: number[]; normal: number[]; index: number[] } {
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
      const p = corner(ci);
      position.push(p[0], p[1], p[2]);
      normal.push(n[0], n[1], n[2]);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
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

function solidPng(size: number, rgba: Rgba): Buffer {
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * stride + 1 + x * 4;
      raw[o] = rgba[0];
      raw[o + 1] = rgba[1];
      raw[o + 2] = rgba[2];
      raw[o + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function wheelParts(): PartSpec[] {
  const parts: PartSpec[] = [
    {
      node: 'shell',
      material: 'shell_mat',
      colour: [0.5, 0.5, 0.5, 1],
      boxes: [BODY_BOX],
    },
  ];
  BIG_WHEEL_BOXES.forEach((box, i) => {
    parts.push({
      node: `shell_${BIG_SUFFIXES[i]}.nr_${BIG_SUFFIXES[i]}`,
      material: 'rubber_shell',
      colour: [0.8, 0.1, 0.1, 1],
      boxes: [box],
    });
    parts.push({
      node: `hub_${SMALL_SUFFIXES[i]}.nr_${SMALL_SUFFIXES[i]}`,
      material: 'plastic_hub',
      colour: [0.1, 0.1, 0.8, 1],
      boxes: [shrink(box, [0.06, 0.165, 0.165])],
    });
  });
  parts.push({
    node: 'wing_a.nr_40',
    material: 'wing_a_mat',
    colour: [0.2, 0.6, 0.2, 1],
    boxes: [UNLISTED_BOX],
  });
  parts.push({
    node: 'wing_B.NR_25',
    material: 'wing_b_mat',
    colour: [0.6, 0.2, 0.6, 1],
    boxes: [CASE_BOX],
  });
  return parts;
}

function texParts(): PartSpec[] {
  return [
    {
      node: 'ford_shell',
      material: 'ford_paint',
      colour: [0.5, 0.5, 0.5, 1],
      boxes: [BODY_BOX],
      texture: { name: 'mustang_decal', size: 64, rgba: [200, 16, 46, 255] },
    },
    {
      node: 'mustang_wing',
      material: 'matt_sponsor',
      colour: [0.4, 0.4, 0.4, 1],
      boxes: [MARKER_BOX],
      texture: { name: 'ford_logo', size: 8, rgba: [16, 46, 200, 255] },
    },
    {
      node: 'matt_wheels',
      material: 'wheelbox',
      colour: [0.05, 0.05, 0.05, 1],
      boxes: BIG_WHEEL_BOXES,
    },
  ];
}

function wheelTexParts(): PartSpec[] {
  return wheelParts().map((part) =>
    part.node === 'shell'
      ? { ...part, texture: { name: 'mustang_decal', size: 64, rgba: [200, 16, 46, 255] as Rgba } }
      : part,
  );
}

function texdefParts(): PartSpec[] {
  return [
    {
      node: 'shell',
      material: 'shell_mat',
      colour: [0.5, 0.5, 0.5, 1],
      boxes: [BODY_BOX],
      texture: { name: 'big_tex', size: 2048, rgba: [32, 128, 64, 255] },
    },
    {
      node: 'wheels',
      material: 'wheelbox',
      colour: [0.05, 0.05, 0.05, 1],
      boxes: BIG_WHEEL_BOXES,
    },
  ];
}

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildCar-075-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

async function writeSource(
  work: string,
  name: string,
  parts: PartSpec[],
  extras?: Record<string, unknown>,
): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  for (const part of parts) {
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    if (part.texture) {
      material.setBaseColorTexture(
        doc
          .createTexture(part.texture.name)
          .setImage(solidPng(part.texture.size, part.texture.rgba)),
      );
    }
    const position: number[] = [];
    const normal: number[] = [];
    const index: number[] = [];
    for (const [min, max] of part.boxes) {
      const g = boxArrays(min, max);
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
    scene.addChild(doc.createNode(part.node).setMesh(doc.createMesh(part.material).addPrimitive(prim)));
  }
  if (extras) Object.assign(doc.getRoot().getAsset(), { extras });
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

function readDocAt(path: string): Promise<Document> {
  return new NodeIO().read(path);
}

function sceneNodes(doc: Document): Map<string, GltfNode> {
  return new Map(doc.getRoot().listScenes()[0].listChildren().map((n) => [n.getName(), n]));
}

function primYExtent(prim: Primitive): number {
  const pos = prim.getAttribute('POSITION');
  const arr = pos?.getArray() as Float32Array;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < arr.length; i += 3) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }
  return max - min;
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function isWebp(bytes: Uint8Array): boolean {
  return hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP');
}

function imageSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (hasAscii(bytes, 0, '\x89PNG')) {
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  if (isWebp(bytes)) {
    const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (tag === 'VP8 ') {
      return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (tag === 'VP8L') {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X') {
      return {
        width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
        height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
      };
    }
  }
  throw new Error('unknown image format');
}

function glbJsonChunk(path: string): string {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return buf.subarray(20, 20 + dv.getUint32(12, true)).toString('utf8');
}

function glbAsset(path: string): Record<string, unknown> {
  return (JSON.parse(glbJsonChunk(path)) as { asset?: Record<string, unknown> }).asset ?? {};
}

async function buildWheelsDoc(work: string): Promise<Document> {
  await writeSource(work, 'wheels.glb', wheelParts());
  writeConfig(work, 'wheels', {
    source: 'assets/vendor/synth/wheels.glb',
    forward: '-z',
    wheelNodes: WHEEL_NODES,
    liveryMaterials: [],
  });
  const result = runBuild(work, ['wheels']);
  expect(result.status, result.output).toBe(0);
  return readDocAt(join(work, 'public', 'models', 'wheels.glb'));
}

async function buildTexDoc(work: string): Promise<Document> {
  await writeSource(work, 'tex.glb', texParts(), TEX_EXTRAS);
  writeConfig(work, 'tex', {
    source: 'assets/vendor/synth/tex.glb',
    forward: '-z',
    wheelMaterials: ['wheelbox'],
    liveryMaterials: [],
    maxTextureSize: 16,
  });
  const result = runBuild(work, ['tex']);
  expect(result.status, result.output).toBe(0);
  return readDocAt(join(work, 'public', 'models', 'tex.glb'));
}

describe('075 car pipeline textures edges', () => {
  it('EDGE1: a config must give wheelNodes or wheelMaterials, else the build throws', async () => {
    const work = sandbox();
    try {
      await writeSource(work, 'sel.glb', wheelParts());
      writeConfig(work, 'nosel', {
        source: 'assets/vendor/synth/sel.glb',
        forward: '-z',
        liveryMaterials: [],
      });
      writeConfig(work, 'wonly', {
        source: 'assets/vendor/synth/sel.glb',
        forward: '-z',
        wheelNodes: WHEEL_NODES,
        liveryMaterials: [],
      });
      expect(runBuild(work, ['nosel']).status).not.toBe(0);
      expect(runBuild(work, ['wonly']).status).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE2: wheelNodes picks nodes whose name contains .nr_ <suffix> and leaves the rest in the body', async () => {
    const work = sandbox();
    try {
      const doc = await buildWheelsDoc(work);
      const nodes = sceneNodes(doc);
      const body = nodes.get('body');
      if (!body) throw new Error('missing body');
      expect(getBounds(body).min[0]).toBeLessThanOrEqual(-2.79);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name}`);
        const b = getBounds(node);
        expect(b.min[0], name).toBeGreaterThan(-1.05);
        expect(b.max[0], name).toBeLessThan(1.05);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE3: wheelNodes matching is case-sensitive', async () => {
    const work = sandbox();
    try {
      const doc = await buildWheelsDoc(work);
      const nodes = sceneNodes(doc);
      const body = nodes.get('body');
      if (!body) throw new Error('missing body');
      expect(getBounds(body).max[0]).toBeGreaterThanOrEqual(2.79);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name}`);
        expect(getBounds(node).max[0], name).toBeLessThan(1.05);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE4: the tyre: and rim: prefixes select the output material class', async () => {
    const work = sandbox();
    try {
      const doc = await buildWheelsDoc(work);
      const nodes = sceneNodes(doc);
      for (const name of WHEEL_NODE_NAMES) {
        const node = nodes.get(name);
        if (!node) throw new Error(`missing ${name}`);
        const byName = new Map(
          (node.getMesh()?.listPrimitives() ?? []).map((p) => [p.getMaterial()?.getName(), p]),
        );
        expect([...byName.keys()].sort(), name).toEqual(['rim', 'tyre']);
        const tyre = byName.get('tyre') as Primitive;
        const rim = byName.get('rim') as Primitive;
        expect(primYExtent(tyre), name).toBeCloseTo(0.33, 2);
        expect(primYExtent(rim), name).toBeCloseTo(0.66, 2);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE5: image sides become min(original, maxTextureSize)', async () => {
    const work = sandbox();
    try {
      const doc = await buildTexDoc(work);
      const sizes = doc
        .getRoot()
        .listTextures()
        .map((t) => {
          const img = t.getImage();
          if (!img) throw new Error(`texture ${t.getName()} has no image`);
          const { width, height } = imageSize(img);
          return `${width}x${height}`;
        });
      expect(sizes.sort()).toEqual(['16x16', '8x8']);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE6: maxTextureSize defaults to 1024 when the config omits it', async () => {
    const work = sandbox();
    try {
      await writeSource(work, 'texdef.glb', texdefParts());
      writeConfig(work, 'texdef', {
        source: 'assets/vendor/synth/texdef.glb',
        forward: '-z',
        wheelMaterials: ['wheelbox'],
        liveryMaterials: [],
      });
      const result = runBuild(work, ['texdef']);
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'texdef.glb'));
      const textures = doc.getRoot().listTextures();
      expect(textures).toHaveLength(1);
      const img = textures[0].getImage();
      if (!img) throw new Error('missing image');
      const { width, height } = imageSize(img);
      expect(width).toBe(1024);
      expect(height).toBe(1024);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE7: every output image is encoded as WebP', async () => {
    const work = sandbox();
    try {
      const doc = await buildTexDoc(work);
      const textures = doc.getRoot().listTextures();
      expect(textures.length).toBeGreaterThan(0);
      for (const t of textures) {
        const img = t.getImage();
        if (!img) throw new Error(`texture ${t.getName()} has no image`);
        expect(isWebp(img), t.getName()).toBe(true);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE8: every body material keeps its baseColorTexture', async () => {
    const work = sandbox();
    try {
      const doc = await buildTexDoc(work);
      const bodyMats = doc
        .getRoot()
        .listMaterials()
        .filter((m) => /^body_\d+$/.test(m.getName()));
      expect(bodyMats).toHaveLength(2);
      for (const m of bodyMats) {
        expect(m.getBaseColorTexture(), m.getName()).not.toBeNull();
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE9: textures are renamed tex_<n> and source brand strings and asset.extras are stripped', async () => {
    const work = sandbox();
    try {
      const doc = await buildTexDoc(work);
      const texNames = doc.getRoot().listTextures().map((t) => t.getName());
      expect(texNames).toHaveLength(2);
      for (const name of texNames) expect(name).toMatch(/^tex_\d+$/);
      const chunk = glbJsonChunk(join(work, 'public', 'models', 'tex.glb')).toLowerCase();
      for (const brand of BRANDS) expect(chunk, brand).not.toContain(brand);
      expect(Object.keys(glbAsset(join(work, 'public', 'models', 'tex.glb')))).not.toContain(
        'extras',
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('EDGE10: rebuilding the same textured car is byte-identical', async () => {
    const work = sandbox();
    try {
      await writeSource(work, 'wt.glb', wheelTexParts());
      writeConfig(work, 'wt', {
        source: 'assets/vendor/synth/wt.glb',
        forward: '-z',
        wheelNodes: WHEEL_NODES,
        liveryMaterials: [],
        maxTextureSize: 16,
      });
      const first = runBuild(work, ['wt']);
      expect(first.status, first.output).toBe(0);
      const glb1 = readFileSync(join(work, 'public', 'models', 'wt.glb'));
      const json1 = readFileSync(join(work, 'public', 'models', 'wt.json'), 'utf8');
      const second = runBuild(work, ['wt']);
      expect(second.status, second.output).toBe(0);
      expect(readFileSync(join(work, 'public', 'models', 'wt.glb')).equals(glb1)).toBe(true);
      expect(readFileSync(join(work, 'public', 'models', 'wt.json'), 'utf8')).toBe(json1);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);
});

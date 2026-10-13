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
import type { Material, Node as GltfNode, Primitive } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];
type Wrap = 33071 | 33648 | 10497;

interface TexSpec {
  name: string;
  width: number;
  height: number;
  rgba: Rgba;
}

interface PartSpec {
  node: string;
  material: string;
  colour: Rgba;
  boxes: [Vec3, Vec3][];
  parent?: string;
  uv?: boolean;
  texture?: TexSpec;
  extra?: Partial<Record<'mr' | 'nrm' | 'occ' | 'emi', TexSpec>>;
  wrap?: [Wrap, Wrap];
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
const TYRE_SUFFIXES = ['25', '26', '28', '29'];
const RIM_SUFFIXES = ['68', '69', '70', '71'];
const GREY: Rgba = [0.5, 0.5, 0.5, 1];
const RED: Rgba = [0.8, 0.1, 0.1, 1];
const BLUE: Rgba = [0.1, 0.1, 0.8, 1];
const GREEN: Rgba = [0.1, 0.8, 0.1, 1];
const MAGENTA: Rgba = [0.9, 0.1, 0.9, 1];
const CYAN: Rgba = [0.1, 0.9, 0.9, 1];
const DARK: Rgba = [0.2, 0.3, 0.4, 1];
const PROBE_BOX: [Vec3, Vec3] = [
  [-0.1, 1.1, 0.0],
  [0.1, 1.3, 0.2],
];
const WRAP_S: Wrap = 33071;
const WRAP_T: Wrap = 33648;

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

function shellPart(colour: Rgba = GREY): PartSpec {
  return { node: 'shell', material: 'shell_mat', colour, boxes: [BODY_BOX] };
}

function tyreParts(colour: Rgba = RED): PartSpec[] {
  return WHEEL_BOXES.map((box, i) => ({
    node: `t_${TYRE_SUFFIXES[i]}.nr_${TYRE_SUFFIXES[i]}`,
    material: 'rubber',
    colour,
    boxes: [box],
  }));
}

function rimParts(colour: Rgba = BLUE): PartSpec[] {
  return WHEEL_BOXES.map((box, i) => ({
    node: `h_${RIM_SUFFIXES[i]}.nr_${RIM_SUFFIXES[i]}`,
    material: 'hub',
    colour,
    boxes: [shrink(box, [0.06, 0.165, 0.165])],
  }));
}

function boxGeom(min: Vec3, max: Vec3, uv: boolean): {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
} {
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
  const quadUv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const [quad, n] of faces) {
    const base = position.length / 3;
    quad.forEach((ci, k) => {
      const p = corner(ci);
      position.push(p[0], p[1], p[2]);
      normal.push(n[0], n[1], n[2]);
      if (uv) uvs.push(quadUv[k][0], quadUv[k][1]);
    });
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { position, normal, uv: uvs, index };
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

function sandbox(): string {
  const work = mkdtempSync(join(tmpdir(), 'buildCar-075p-'));
  mkdirSync(join(work, 'tools'), { recursive: true });
  mkdirSync(join(work, 'public', 'models'), { recursive: true });
  mkdirSync(join(work, 'assets', 'cars'), { recursive: true });
  mkdirSync(join(work, 'assets', 'vendor', 'synth'), { recursive: true });
  cpSync(join(ROOT, 'tools', 'assets'), join(work, 'tools', 'assets'), { recursive: true });
  copyFileSync(join(ROOT, 'package.json'), join(work, 'package.json'));
  symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'dir');
  return work;
}

async function writeSource(work: string, name: string, parts: PartSpec[]): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const groups = new Map<string, GltfNode>();
  const groupOf = (label: string): GltfNode => {
    const hit = groups.get(label);
    if (hit) return hit;
    const node = doc.createNode(label);
    scene.addChild(node);
    groups.set(label, node);
    return node;
  };
  for (const part of parts) {
    const material = doc.createMaterial(part.material).setBaseColorFactor(part.colour);
    const attach = (slot: 'mr' | 'nrm' | 'occ' | 'emi', tex: TexSpec): void => {
      const texture = doc
        .createTexture(tex.name)
        .setImage(solidPng(tex.width, tex.height, tex.rgba));
      if (slot === 'mr') material.setMetallicRoughnessTexture(texture);
      if (slot === 'nrm') material.setNormalTexture(texture);
      if (slot === 'occ') material.setOcclusionTexture(texture);
      if (slot === 'emi') material.setEmissiveTexture(texture);
    };
    if (part.texture) {
      const t = part.texture;
      material.setBaseColorTexture(
        doc.createTexture(t.name).setImage(solidPng(t.width, t.height, t.rgba)),
      );
      if (part.wrap) {
        const info = material.getBaseColorTextureInfo();
        if (info) info.setWrapS(part.wrap[0]).setWrapT(part.wrap[1]);
      }
    }
    for (const slot of ['mr', 'nrm', 'occ', 'emi'] as const) {
      const tex = part.extra?.[slot];
      if (tex) attach(slot, tex);
    }
    const position: number[] = [];
    const normal: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (const [min, max] of part.boxes) {
      const g = boxGeom(min, max, part.uv ?? false);
      const base = position.length / 3;
      position.push(...g.position);
      normal.push(...g.normal);
      uvs.push(...g.uv);
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
      );
    if (uvs.length > 0) {
      prim.setAttribute(
        'TEXCOORD_0',
        doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array(uvs)),
      );
    }
    prim.setIndices(
      doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(index)),
    );
    const node = doc
      .createNode(part.node)
      .setMesh(doc.createMesh(part.material).addPrimitive(prim));
    (part.parent ? groupOf(part.parent) : scene).addChild(node);
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
  writeConfig(work, id, {
    source: `assets/vendor/synth/${id}.glb`,
    forward: '-z',
    liveryMaterials: [],
    ...cfg,
  });
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

function materialByName(doc: Document, name: string): Material | undefined {
  return doc.getRoot().listMaterials().find((m) => m.getName() === name);
}

function primMaterialNames(prim: Primitive): string {
  return prim.getMaterial()?.getName() ?? '';
}

function glbJsonChunk(path: string): string {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return buf.subarray(20, 20 + dv.getUint32(12, true)).toString('utf8');
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function imageSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (hasAscii(bytes, 0, 'RIFF') && hasAscii(bytes, 8, 'WEBP')) {
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
    throw new Error(`unknown webp chunk ${tag}`);
  }
  if (hasAscii(bytes, 0, '\x89PNG')) {
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  throw new Error('unknown image format');
}

describe('075 car pipeline textures post checks', () => {
  it('POST1: a wheelNodes suffix matches only with a non-digit boundary', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'bound',
        [
          shellPart(),
          ...tyreParts(),
          { node: 'hit_a.nr_5', material: 'probe_a', colour: MAGENTA, boxes: [PROBE_BOX] },
          { node: 'hit_b.nr_5.001', material: 'probe_b', colour: CYAN, boxes: [PROBE_BOX] },
          { node: 'miss.nr_51', material: 'probe_c', colour: DARK, boxes: [PROBE_BOX] },
        ],
        { wheelNodes: ['rim:5', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)] },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'bound.glb'));
      const bodies = bodyMaterials(doc);
      expect(bodies.some((m) => isColour(m, MAGENTA)), 'hit_a.nr_5 must leave the body').toBe(false);
      expect(bodies.some((m) => isColour(m, CYAN)), 'hit_b.nr_5.001 must leave the body').toBe(false);
      expect(bodies.some((m) => isColour(m, DARK)), 'miss.nr_51 must stay in the body').toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST2: a wheelNodes suffix without a class prefix is treated as rim', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'bare',
        [
          shellPart(),
          ...tyreParts(),
          { node: 'probe.nr_5', material: 'probe_mat', colour: MAGENTA, boxes: [PROBE_BOX] },
        ],
        { wheelNodes: ['5', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)] },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'bare.glb'));
      const rim = materialByName(doc, 'rim');
      const tyre = materialByName(doc, 'tyre');
      if (!rim || !tyre) throw new Error('missing tyre or rim material');
      expect(isColour(rim, MAGENTA), 'rim colour comes from the bare-suffix node').toBe(true);
      expect(isColour(tyre, RED), 'tyre colour comes from the tyre: nodes').toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST3: a wheelNodes class other than tyre or rim fails the build', async () => {
    const work = sandbox();
    try {
      const result = await build(work, 'badcls', [shellPart(), ...tyreParts()], {
        wheelNodes: ['body:25', ...TYRE_SUFFIXES.slice(1).map((s) => `tyre:${s}`)],
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('tyre:<suffix> or rim:<suffix>');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST4: empty wheelNodes and wheelMaterials arrays fail the build', async () => {
    const work = sandbox();
    try {
      const result = await build(work, 'empty', [shellPart(), ...tyreParts()], {
        wheelNodes: [],
        wheelMaterials: [],
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('wheelNodes or wheelMaterials');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST5: wheelNodes that match no node fail the build', async () => {
    const work = sandbox();
    try {
      const result = await build(work, 'nomatch', [shellPart(), ...tyreParts()], {
        wheelNodes: ['tyre:99'],
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('no wheel geometry matched');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST6: a wheelNodes match on an ancestor node reaches the mesh node', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'group',
        [
          shellPart(),
          ...tyreParts(),
          {
            node: 'kid',
            parent: 'grp.nr_25',
            material: 'probe_mat',
            colour: MAGENTA,
            boxes: [PROBE_BOX],
          },
        ],
        { wheelNodes: ['rim:25', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)] },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'group.glb'));
      expect(
        bodyMaterials(doc).some((m) => isColour(m, MAGENTA)),
        'child of a matching group node must leave the body',
      ).toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST7: a wheelNodes class wins over a livery material match', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'cls',
        [
          shellPart(),
          ...tyreParts(),
          { node: 'probe.nr_5', material: 'rubber_probe', colour: MAGENTA, boxes: [PROBE_BOX] },
        ],
        {
          wheelNodes: ['rim:5', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)],
          liveryMaterials: ['rubber_probe'],
        },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'cls.glb'));
      const rim = materialByName(doc, 'rim');
      const tyre = materialByName(doc, 'tyre');
      if (!rim || !tyre) throw new Error('missing tyre or rim material');
      expect(isColour(rim, MAGENTA), 'node class sends the probe to rim').toBe(true);
      expect(isColour(tyre, RED), 'node class keeps the probe out of tyre').toBe(true);
      expect(materialByName(doc, 'livery'), 'livery must not win on a wheel node').toBeUndefined();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST8: body materials keep metallicRoughness, normal, occlusion and emissive textures', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'slots',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { name: 'base', width: 16, height: 16, rgba: RED },
            extra: {
              mr: { name: 'mr', width: 16, height: 16, rgba: BLUE },
              nrm: { name: 'nrm', width: 16, height: 16, rgba: GREEN },
              occ: { name: 'occ', width: 16, height: 16, rgba: CYAN },
              emi: { name: 'emi', width: 16, height: 16, rgba: MAGENTA },
            },
          },
          { node: 'wheels', material: 'wheelbox', colour: GREY, boxes: WHEEL_BOXES },
        ],
        { wheelMaterials: ['wheelbox'], maxTextureSize: 32 },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'slots.glb'));
      const body = bodyMaterials(doc).find((m) => m.getBaseColorTexture());
      if (!body) throw new Error('missing textured body material');
      const slots = [
        body.getBaseColorTexture(),
        body.getMetallicRoughnessTexture(),
        body.getNormalTexture(),
        body.getOcclusionTexture(),
        body.getEmissiveTexture(),
      ];
      for (const [i, tex] of slots.entries()) {
        expect(tex, `slot ${i}`).not.toBeNull();
        expect(tex?.getName() ?? '', `slot ${i}`).toMatch(/^tex_\d+$/);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST9: texture wrap modes survive into the output body material', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'wrap',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { name: 'base', width: 16, height: 16, rgba: RED },
            wrap: [WRAP_S, WRAP_T],
          },
          { node: 'wheels', material: 'wheelbox', colour: GREY, boxes: WHEEL_BOXES },
        ],
        { wheelMaterials: ['wheelbox'], maxTextureSize: 32 },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'wrap.glb'));
      const body = bodyMaterials(doc).find((m) => m.getBaseColorTexture());
      if (!body) throw new Error('missing textured body material');
      const info = body.getBaseColorTextureInfo();
      if (!info) throw new Error('missing baseColorTextureInfo');
      expect(info.getWrapS()).toBe(WRAP_S);
      expect(info.getWrapT()).toBe(WRAP_T);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST10: same-colour tyre and rim materials are both present after dedup', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'twin',
        [shellPart(DARK), ...tyreParts(GREY), ...rimParts(GREY)],
        { wheelNodes: [...TYRE_SUFFIXES.map((s) => `tyre:${s}`), ...RIM_SUFFIXES.map((s) => `rim:${s}`)] },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'twin.glb'));
      const tyre = materialByName(doc, 'tyre');
      const rim = materialByName(doc, 'rim');
      if (!tyre || !rim) throw new Error(`missing named role materials: ${doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName())
        .join(',')}`);
      expect(isColour(tyre, GREY)).toBe(true);
      expect(isColour(rim, GREY)).toBe(true);
      const scene = doc.getRoot().listScenes()[0];
      for (const name of [
        'wheel-front-left',
        'wheel-front-right',
        'wheel-back-left',
        'wheel-back-right',
      ]) {
        const node = scene.listChildren().find((n) => n.getName() === name);
        const names = (node?.getMesh()?.listPrimitives() ?? []).map(primMaterialNames).sort();
        expect(names, name).toEqual(['rim', 'tyre']);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST11: merged textured and untextured pieces keep TEXCOORD_0 aligned with POSITION and finite', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'mixed',
        [
          shellPart(),
          ...tyreParts(),
          {
            node: 'rim_tex.nr_68',
            material: 'rim_tex_mat',
            colour: MAGENTA,
            boxes: [shrink(WHEEL_BOXES[2], [0.1, 0.2, 0.2])],
            uv: true,
            texture: { name: 'rim_decal', width: 8, height: 8, rgba: MAGENTA },
          },
          {
            node: 'rim_plain.nr_69',
            material: 'rim_plain_mat',
            colour: CYAN,
            boxes: [shrink(WHEEL_BOXES[2], [0.14, 0.24, 0.24])],
          },
        ],
        {
          wheelNodes: ['rim:68', 'rim:69', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)],
          maxTextureSize: 16,
        },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'mixed.glb'));
      for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute('POSITION');
          const uv = prim.getAttribute('TEXCOORD_0');
          if (!pos) throw new Error(`${mesh.getName()} prim without POSITION`);
          if (uv) {
            expect(uv.getCount(), `${mesh.getName()} TEXCOORD_0 vs POSITION`).toBe(pos.getCount());
            const arr = uv.getArray() as Float32Array;
            for (let i = 0; i < arr.length; i++) {
              expect(Number.isFinite(arr[i]), `${mesh.getName()} TEXCOORD_0[${i}]`).toBe(true);
            }
          }
        }
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST12: a non-square texture keeps its aspect ratio inside maxTextureSize', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'aspect',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { name: 'wide', width: 64, height: 8, rgba: RED },
          },
          { node: 'wheels', material: 'wheelbox', colour: GREY, boxes: WHEEL_BOXES },
        ],
        { wheelMaterials: ['wheelbox'], maxTextureSize: 16 },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'aspect.glb'));
      const textures = doc.getRoot().listTextures();
      expect(textures).toHaveLength(1);
      const img = textures[0].getImage();
      if (!img) throw new Error('missing image');
      expect(imageSize(img)).toEqual({ width: 16, height: 2 });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST13: webp images declare EXT_texture_webp in the glb', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'ext',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { name: 'base', width: 16, height: 16, rgba: RED },
          },
          { node: 'wheels', material: 'wheelbox', colour: GREY, boxes: WHEEL_BOXES },
        ],
        { wheelMaterials: ['wheelbox'], maxTextureSize: 32 },
      );
      expect(result.status, result.output).toBe(0);
      const json = JSON.parse(glbJsonChunk(join(work, 'public', 'models', 'ext.glb'))) as {
        extensionsUsed?: string[];
        images: { mimeType?: string }[];
      };
      expect(json.images.map((i) => i.mimeType)).toContain('image/webp');
      expect(json.extensionsUsed ?? []).toContain('EXT_texture_webp');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST14: a non-positive maxTextureSize fails the build', async () => {
    const work = sandbox();
    try {
      for (const [id, size] of [
        ['zero', 0],
        ['neg', -8],
      ] as const) {
        const result = await build(
          work,
          id,
          [
            {
              node: 'shell',
              material: 'shell_mat',
              colour: GREY,
              boxes: [BODY_BOX],
              texture: { name: 'base', width: 16, height: 16, rgba: RED },
            },
            { node: 'wheels', material: 'wheelbox', colour: GREY, boxes: WHEEL_BOXES },
          ],
          { wheelMaterials: ['wheelbox'], maxTextureSize: size },
        );
        expect(result.status, `${id} maxTextureSize ${size}`).not.toBe(0);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST15: only body materials keep textures; wheel and livery drop theirs', async () => {
    const work = sandbox();
    try {
      const tex = { name: 'map', width: 16, height: 16, rgba: RED };
      const result = await build(
        work,
        'droptex',
        [
          {
            node: 'shell',
            material: 'shell_mat',
            colour: GREY,
            boxes: [BODY_BOX],
            texture: { ...tex, name: 'body_map' },
          },
          {
            node: 'livery_part',
            material: 'livery_paint',
            colour: MAGENTA,
            boxes: [PROBE_BOX],
            texture: { ...tex, name: 'liv_map' },
          },
          ...tyreParts().map((p) => ({ ...p, texture: { ...tex, name: 'tyre_map' } })),
          ...rimParts().map((p) => ({ ...p, texture: { ...tex, name: 'rim_map' } })),
        ],
        {
          wheelNodes: [
            ...TYRE_SUFFIXES.map((s) => `tyre:${s}`),
            ...RIM_SUFFIXES.map((s) => `rim:${s}`),
          ],
          liveryMaterials: ['livery_paint'],
          maxTextureSize: 32,
        },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'droptex.glb'));
      expect(bodyMaterials(doc).some((m) => m.getBaseColorTexture())).toBe(true);
      for (const name of ['livery', 'tyre', 'rim']) {
        const m = materialByName(doc, name);
        if (!m) throw new Error(`missing ${name}`);
        const slots = [
          m.getBaseColorTexture(),
          m.getMetallicRoughnessTexture(),
          m.getNormalTexture(),
          m.getOcclusionTexture(),
          m.getEmissiveTexture(),
        ];
        for (const [i, slot] of slots.entries()) expect(slot, `${name} slot ${i}`).toBeNull();
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST16: the json wheelRadius comes from the tyre-class geometry', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'radius',
        [
          shellPart(),
          ...tyreParts(),
          ...WHEEL_BOXES.map((box, i) => ({
            node: `small_${RIM_SUFFIXES[i]}.nr_${RIM_SUFFIXES[i]}`,
            material: 'hub_small',
            colour: BLUE,
            boxes: [shrink(box, [0.06, 0.05, 0.165])],
          })),
        ],
        {
          wheelNodes: [
            ...TYRE_SUFFIXES.map((s) => `tyre:${s}`),
            ...RIM_SUFFIXES.map((s) => `rim:${s}`),
          ],
        },
      );
      expect(result.status, result.output).toBe(0);
      const meta = JSON.parse(
        readFileSync(join(work, 'public', 'models', 'radius.json'), 'utf8'),
      ) as { wheelRadius: number };
      expect(meta.wheelRadius).toBeCloseTo(0.33, 3);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST17: a wheelNodes class prefix is case-sensitive', async () => {
    const work = sandbox();
    try {
      const result = await build(work, 'badcase', [shellPart(), ...tyreParts()], {
        wheelNodes: ['TYRE:25', ...TYRE_SUFFIXES.slice(1).map((s) => `tyre:${s}`)],
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('tyre:<suffix> or rim:<suffix>');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST18: the node wheel class wins over a tyre-or-rubber material name', async () => {
    const work = sandbox();
    try {
      const result = await build(
        work,
        'namewin',
        [
          shellPart(),
          ...tyreParts(),
          { node: 'probe.nr_5', material: 'rubber_probe', colour: MAGENTA, boxes: [PROBE_BOX] },
        ],
        {
          wheelNodes: ['rim:5', ...TYRE_SUFFIXES.map((s) => `tyre:${s}`)],
        },
      );
      expect(result.status, result.output).toBe(0);
      const doc = await readDocAt(join(work, 'public', 'models', 'namewin.glb'));
      const rim = materialByName(doc, 'rim');
      if (!rim) throw new Error('rubber_probe must land in rim despite its name');
      expect(isColour(rim, MAGENTA)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120000);

  it('POST19: the gt3-d config carries the task limits and all twelve wheel suffixes', () => {
    const cfg = JSON.parse(
      readFileSync(join(ROOT, 'assets', 'cars', 'gt3-d.pipeline.json'), 'utf8'),
    ) as {
      source: string;
      forward: string;
      targetLength: number;
      wheelNodes: string[];
      liveryMaterials: string[];
      triBudget: number;
      maxTextureSize: number;
      outGlb: string;
      outJson: string;
    };
    expect(cfg.source).toBe('assets/vendor/cars/mustang-gt3/ford_mustang_gt3.glb');
    expect(cfg.forward).toBe('+z');
    expect(cfg.targetLength).toBeCloseTo(4.79, 6);
    expect(cfg.triBudget).toBe(90000);
    expect(cfg.maxTextureSize).toBe(1024);
    expect(cfg.liveryMaterials).toEqual([]);
    expect(cfg.outGlb).toBe('public/models/gt3-d.glb');
    expect(cfg.outJson).toBe('public/models/gt3-d.json');
    const suffixes = cfg.wheelNodes.map((entry) => {
      expect(entry).toMatch(/^(tyre|rim):\d+$/);
      return entry.slice(entry.indexOf(':') + 1);
    });
    expect(suffixes.sort()).toEqual(['25', '26', '28', '29', '5', '6', '7', '8', '68', '69', '70', '71'].sort());
  });
});

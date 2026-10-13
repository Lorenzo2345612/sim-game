import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';
import type { Document } from '@gltf-transform/core';
import { buildCar } from '../../../tools/assets/buildCar';

const MODELS = join(__dirname, '..', '..', '..', 'public', 'models');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

const LEGACY_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c'];
const BRANDS = ['ford', 'mustang'];
const MAX_IMAGE_PX = 1024;
const MAX_GLB_BYTES = 12 * 1024 * 1024;
const TARGET_LENGTH = 4.79;
const LENGTH_TOL = 0.08;

interface CarMeta {
  wheelRadius: number;
  wheelbase: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

function glbPath(id: string): string {
  return join(MODELS, `${id}.glb`);
}

function metaPath(id: string): string {
  return join(MODELS, `${id}.json`);
}

function readMeta(id: string): CarMeta {
  return JSON.parse(readFileSync(metaPath(id), 'utf8')) as CarMeta;
}

async function readDoc(id: string): Promise<Document> {
  return new NodeIO().read(glbPath(id));
}

function rootNames(doc: Document): string[] {
  return doc
    .getRoot()
    .listScenes()[0]
    .listChildren()
    .map((n) => n.getName())
    .sort();
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

function wheelByName(meta: CarMeta, name: string): { name: string; x: number; y: number; z: number } {
  const wheel = meta.wheels.find((w) => w.name === name);
  if (!wheel) throw new Error(`missing wheel ${name}`);
  return wheel;
}

function hasAscii(bytes: Uint8Array, offset: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function imageSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (hasAscii(bytes, 0, '\x89PNG')) {
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
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
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: dv.getUint16(i + 7, false), height: dv.getUint16(i + 5, false) };
      }
      i += 2 + dv.getUint16(i + 2, false);
    }
    throw new Error('jpeg size not found');
  }
  throw new Error('unknown image format');
}

function imageSizeOfDoc(doc: Document): { width: number; height: number }[] {
  const textures = doc.getRoot().listTextures();
  if (textures.length === 0) throw new Error('gt3-d output has no textures to measure');
  return textures.map((texture) => {
    const image = texture.getImage();
    if (!image) throw new Error(`texture ${texture.getName()} has no image`);
    return imageSize(image);
  });
}

function glbJsonChunk(path: string): string {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return buf.subarray(20, 20 + dv.getUint32(12, true)).toString('utf8');
}

describe('075 car pipeline textures acceptance', () => {
  beforeAll(async () => {
    await buildCar('gt3-d');
  }, 600000);

  it('AT1: gt3-d has the body and four wheel nodes and no more than 90000 triangles', async () => {
    const doc = await readDoc('gt3-d');
    expect(rootNames(doc)).toEqual(['body', ...WHEEL_NODE_NAMES].sort());
    expect(triangleCount(doc)).toBeLessThanOrEqual(90000);
  });

  it('AT2: every gt3-d image is at most 1024 px per side and the glb is at most 12 MB', async () => {
    const doc = await readDoc('gt3-d');
    for (const { width, height } of imageSizeOfDoc(doc)) {
      expect(width).toBeLessThanOrEqual(MAX_IMAGE_PX);
      expect(height).toBeLessThanOrEqual(MAX_IMAGE_PX);
    }
    expect(readFileSync(glbPath('gt3-d')).length).toBeLessThanOrEqual(MAX_GLB_BYTES);
  });

  it('AT3: gt3-d dimensions, wheel data and ground clearance match the given ranges', async () => {
    const doc = await readDoc('gt3-d');
    const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
    expect(Math.abs(max[2] - min[2] - TARGET_LENGTH)).toBeLessThanOrEqual(LENGTH_TOL);
    const width = max[0] - min[0];
    expect(width).toBeGreaterThanOrEqual(1.9);
    expect(width).toBeLessThanOrEqual(2.15);
    const meta = readMeta('gt3-d');
    expect(meta.wheelbase).toBeGreaterThanOrEqual(2.6);
    expect(meta.wheelbase).toBeLessThanOrEqual(2.95);
    expect(meta.wheelRadius).toBeGreaterThanOrEqual(0.3);
    expect(meta.wheelRadius).toBeLessThanOrEqual(0.37);
    expect(wheelByName(meta, 'wheel-front-left').z).toBeLessThan(0);
    expect(wheelByName(meta, 'wheel-front-right').z).toBeLessThan(0);
    expect(wheelByName(meta, 'wheel-front-left').x).toBeLessThan(0);
    expect(wheelByName(meta, 'wheel-back-left').x).toBeLessThan(0);
    expect(min[1]).toBeGreaterThanOrEqual(-0.02);
  });

  it('AT4: gt3-d glb names/strings and json contain no ford or mustang', () => {
    const glbStrings = glbJsonChunk(glbPath('gt3-d')).toLowerCase();
    const json = readFileSync(metaPath('gt3-d'), 'utf8').toLowerCase();
    for (const brand of BRANDS) {
      expect(glbStrings, `gt3-d glb ${brand}`).not.toContain(brand);
      expect(json, `gt3-d json ${brand}`).not.toContain(brand);
    }
  });

  it('AT5: rebuilding gt3-a, gt3-b, gt3-c and f4 leaves their outputs unchanged', async () => {
    const before = LEGACY_IDS.map((id) => ({
      id,
      glb: readFileSync(glbPath(id)),
      json: readFileSync(metaPath(id), 'utf8'),
    }));
    for (const id of LEGACY_IDS) await buildCar(id);
    for (const { id, glb, json } of before) {
      expect(readFileSync(glbPath(id)).equals(glb), `${id} glb`).toBe(true);
      expect(readFileSync(metaPath(id), 'utf8'), `${id} json`).toBe(json);
    }
  }, 600000);
});

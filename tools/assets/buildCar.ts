import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Accessor,
  Document,
  Material,
  Mesh,
  Node,
  NodeIO,
  Primitive,
  Texture,
  TextureInfo,
  type vec4,
} from '@gltf-transform/core';
import {
  dedup,
  prune,
  simplifyPrimitive,
  textureCompress,
  transformMesh,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { buildF4 } from './buildF4';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_DIR = join(ROOT, 'assets', 'cars');

const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

type WheelName = (typeof WHEEL_NODE_NAMES)[number];
type Role = 'wheel' | 'livery' | 'body';

export interface CarPipelineConfig {
  source: string;
  forward: '+x' | '-x' | '+z' | '-z';
  targetLength: number;
  wheelMaterials?: string[];
  wheelNodes?: string[];
  liveryMaterials: string[];
  dropNodes?: string[];
  neutralMaterials?: string[];
  wheelTriBudget?: number;
  triBudget: number;
  maxTextureSize?: number;
  outGlb: string;
  outJson: string;
}

const LIVERY_COLOUR: vec4 = [200 / 255, 16 / 255, 46 / 255, 1];
const DEFAULT_COLOUR: vec4 = [0.5, 0.5, 0.5, 1];
const SIMPLIFY_ERROR = 0.02;
const FORBIDDEN = [
  'mclaren',
  'porsche',
  'porche',
  'audi',
  'tatuus',
  'lamborghini',
  'ford',
  'mustang',
  'mattdoesblender',
] as const;

interface Geom {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
}

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

interface Piece {
  geom: Geom;
  role: Role;
  isTyre: boolean;
  source: string;
}

function emptyGeom(): Geom {
  return { position: [], normal: [], uv: [], index: [] };
}

function geomBounds(g: Geom): BBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = g.position[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function bboxCentre(b: BBox): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

function unionBounds(list: Geom[]): BBox {
  const out: BBox = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const g of list) {
    const b = geomBounds(g);
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < out.min[k]) out.min[k] = b.min[k];
      if (b.max[k] > out.max[k]) out.max[k] = b.max[k];
    }
  }
  return out;
}

function translateGeom(g: Geom, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < g.position.length; i += 3) {
    g.position[i] += dx;
    g.position[i + 1] += dy;
    g.position[i + 2] += dz;
  }
}

function scaleGeom(g: Geom, s: number): void {
  for (let i = 0; i < g.position.length; i++) g.position[i] *= s;
}

/** Rotates about Y so the nose ends up at -Z; (x, y, z) -> (x c + z s, y, -x s + z c). */
function rotateGeomY(g: Geom, c: number, s: number): void {
  for (let i = 0; i < g.position.length; i += 3) {
    const x = g.position[i];
    const z = g.position[i + 2];
    g.position[i] = x * c + z * s;
    g.position[i + 2] = -x * s + z * c;
    const nx = g.normal[i];
    const nz = g.normal[i + 2];
    g.normal[i] = nx * c + nz * s;
    g.normal[i + 2] = -nx * s + nz * c;
  }
}

function mergeGeoms(list: Geom[]): Geom {
  const out = emptyGeom();
  for (const g of list) {
    const base = out.position.length / 3;
    for (let i = 0; i < g.position.length; i++) {
      out.position.push(g.position[i]);
      out.normal.push(g.normal[i]);
    }
    for (let i = 0; i < g.uv.length; i++) out.uv.push(g.uv[i]);
    for (let i = 0; i < g.index.length; i++) out.index.push(g.index[i] + base);
  }
  return out;
}

function cloneAccessor(doc: Document, src: Accessor): Accessor {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const array = src.getArray();
  return doc
    .createAccessor()
    .setBuffer(buffer)
    .setType(src.getType())
    .setNormalized(src.getNormalized())
    .setArray(array ? array.slice() : null);
}

/** Deep copy so baking one node never mutates geometry another node still shares. */
function cloneMeshDeep(doc: Document, mesh: Mesh): Mesh {
  const out = doc.createMesh();
  for (const prim of mesh.listPrimitives()) {
    const copy = doc.createPrimitive().setMode(prim.getMode());
    const material = prim.getMaterial();
    if (material) copy.setMaterial(material);
    const indices = prim.getIndices();
    if (indices) copy.setIndices(cloneAccessor(doc, indices));
    for (const semantic of prim.listSemantics()) {
      const attr = prim.getAttribute(semantic);
      if (attr) copy.setAttribute(semantic, cloneAccessor(doc, attr));
    }
    out.addPrimitive(copy);
  }
  return out;
}

function weldPositions(prim: Primitive, keepUv: boolean): void {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const idx = prim.getIndices();
  if (!pos || !nrm || !idx) throw new Error('primitive missing POSITION, NORMAL or indices');
  const pa = pos.getArray() as Float32Array;
  const na = nrm.getArray() as Float32Array;
  const ia = idx.getArray() as Uint16Array | Uint32Array;
  const uvAttr = keepUv ? prim.getAttribute('TEXCOORD_0') : null;
  const ua = uvAttr ? (uvAttr.getArray() as Float32Array) : null;
  const remap = new Uint32Array(pa.length / 3);
  const byKey = new Map<string, number>();
  const newPos: number[] = [];
  const newNrm: number[] = [];
  const newUv: number[] = [];
  for (let i = 0; i < pa.length / 3; i++) {
    // UV is part of the key only when kept, so untextured welds stay position-only (071 bytes).
    const key = ua
      ? `${pa[i * 3]} ${pa[i * 3 + 1]} ${pa[i * 3 + 2]} ${ua[i * 2]} ${ua[i * 2 + 1]}`
      : `${pa[i * 3]} ${pa[i * 3 + 1]} ${pa[i * 3 + 2]}`;
    let target = byKey.get(key);
    if (target === undefined) {
      target = newPos.length / 3;
      byKey.set(key, target);
      newPos.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      newNrm.push(0, 0, 0);
      if (ua) newUv.push(ua[i * 2], ua[i * 2 + 1]);
    }
    newNrm[target * 3] += na[i * 3];
    newNrm[target * 3 + 1] += na[i * 3 + 1];
    newNrm[target * 3 + 2] += na[i * 3 + 2];
    remap[i] = target;
  }
  for (let i = 0; i < newNrm.length; i += 3) {
    const len = Math.hypot(newNrm[i], newNrm[i + 1], newNrm[i + 2]) || 1;
    newNrm[i] /= len;
    newNrm[i + 1] /= len;
    newNrm[i + 2] /= len;
  }
  const out = new Uint32Array(ia.length);
  for (let i = 0; i < ia.length; i++) out[i] = remap[ia[i]];
  pos.setArray(new Float32Array(newPos));
  nrm.setArray(new Float32Array(newNrm));
  if (uvAttr) uvAttr.setArray(new Float32Array(newUv));
  idx.setArray(out);
}

function readGeom(prim: Primitive, scale: number, keepUv: boolean): Geom {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const idx = prim.getIndices();
  if (!pos || !nrm) throw new Error('primitive missing POSITION or NORMAL');
  const posArr = pos.getArray() as Float32Array;
  const nrmArr = nrm.getArray() as Float32Array;
  const uvArr = keepUv ? (prim.getAttribute('TEXCOORD_0')?.getArray() as Float32Array | undefined) : undefined;
  const out = emptyGeom();
  for (let v = 0; v < posArr.length / 3; v++) {
    out.position.push(posArr[v * 3] * scale, posArr[v * 3 + 1] * scale, posArr[v * 3 + 2] * scale);
    out.normal.push(nrmArr[v * 3], nrmArr[v * 3 + 1], nrmArr[v * 3 + 2]);
    if (uvArr) out.uv.push(uvArr[v * 2], uvArr[v * 2 + 1]);
  }
  if (idx) {
    for (const v of idx.getArray() as Uint16Array | Uint32Array) out.index.push(v);
  } else {
    for (let v = 0; v < posArr.length / 3; v++) out.index.push(v);
  }
  return out;
}

/** Splits triangles by the quadrant of their centroid relative to (xMid, zMid). */
function splitByQuadrant(g: Geom, xMid: number, zMid: number): Map<WheelName, Geom> {
  const out = new Map<WheelName, Geom>();
  for (const name of WHEEL_NODE_NAMES) out.set(name, emptyGeom());
  for (let t = 0; t < g.index.length; t += 3) {
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      const vi = g.index[t + k];
      cx += g.position[vi * 3] / 3;
      cz += g.position[vi * 3 + 2] / 3;
    }
    const name = `wheel-${cz < zMid ? 'front' : 'back'}-${cx < xMid ? 'left' : 'right'}` as WheelName;
    const dst = out.get(name) as Geom;
    const base = dst.position.length / 3;
    for (let k = 0; k < 3; k++) {
      const vi = g.index[t + k];
      dst.position.push(g.position[vi * 3], g.position[vi * 3 + 1], g.position[vi * 3 + 2]);
      dst.normal.push(g.normal[vi * 3], g.normal[vi * 3 + 1], g.normal[vi * 3 + 2]);
      if (g.uv.length > 0) dst.uv.push(g.uv[vi * 2], g.uv[vi * 2 + 1]);
      dst.index.push(base + k);
    }
  }
  return out;
}

function createPrim(doc: Document, g: Geom, material: Material): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  prim.setAttribute(
    'POSITION',
    doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(g.position)),
  );
  prim.setAttribute(
    'NORMAL',
    doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(g.normal)),
  );
  if (g.uv.length > 0) {
    prim.setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array(g.uv)),
    );
  }
  prim.setIndices(
    doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint32Array(g.index)),
  );
  prim.setMaterial(material);
  return prim;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function triCount(prims: Primitive[]): number {
  let n = 0;
  for (const prim of prims) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    n += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
  }
  return n;
}

function matches(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

interface WheelNodeEntry {
  cls: 'tyre' | 'rim';
  suffix: string;
}

function parseWheelNodes(list: string[]): WheelNodeEntry[] {
  return list.map((entry) => {
    const sep = entry.indexOf(':');
    const cls = sep === -1 ? 'rim' : entry.slice(0, sep);
    const suffix = sep === -1 ? entry : entry.slice(sep + 1);
    if (cls !== 'tyre' && cls !== 'rim') {
      throw new Error(`wheelNodes entry must be tyre:<suffix> or rim:<suffix>: ${entry}`);
    }
    return { cls, suffix };
  });
}

/** Matches ".nr_<suffix>" with a non-digit boundary so ".nr_5" never hits ".nr_51". */
function matchWheelNode(name: string, entries: WheelNodeEntry[]): 'tyre' | 'rim' | null {
  for (const entry of entries) {
    const needle = `.nr_${entry.suffix}`;
    let from = 0;
    for (;;) {
      const at = name.indexOf(needle, from);
      if (at === -1) break;
      const next = name.charCodeAt(at + needle.length);
      if (!(next >= 48 && next <= 57)) return entry.cls;
      from = at + 1;
    }
  }
  return null;
}

function hasTexture(material: Material | null): boolean {
  if (!material) return false;
  return !!(
    material.getBaseColorTexture() ||
    material.getMetallicRoughnessTexture() ||
    material.getNormalTexture() ||
    material.getOcclusionTexture() ||
    material.getEmissiveTexture()
  );
}

function sniffMime(image: Uint8Array): string {
  if (image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47) {
    return 'image/png';
  }
  if (image[0] === 0xff && image[1] === 0xd8) return 'image/jpeg';
  if (image[0] === 0x52 && image[8] === 0x57) return 'image/webp';
  return 'image/png';
}

function copyTextureOf(
  doc: Document,
  src: Texture | null,
  cache: Map<Texture, Texture>,
): Texture | null {
  if (!src) return null;
  const hit = cache.get(src);
  if (hit) return hit;
  const image = src.getImage();
  const dst = doc
    .createTexture()
    .setMimeType(src.getMimeType() || (image ? sniffMime(image) : 'image/png'))
    .setImage(image ? image.slice() : null);
  cache.set(src, dst);
  return dst;
}

function copyTextureInfo(src: TextureInfo | null, dst: TextureInfo | null): void {
  if (!src || !dst) return;
  dst.setTexCoord(src.getTexCoord());
  dst.setWrapS(src.getWrapS());
  dst.setWrapT(src.getWrapT());
  dst.setMagFilter(src.getMagFilter());
  dst.setMinFilter(src.getMinFilter());
}

function copyBodyTextures(
  doc: Document,
  src: Material,
  dst: Material,
  cache: Map<Texture, Texture>,
): void {
  const base = copyTextureOf(doc, src.getBaseColorTexture(), cache);
  if (base) {
    dst.setBaseColorTexture(base);
    copyTextureInfo(src.getBaseColorTextureInfo(), dst.getBaseColorTextureInfo());
  }
  const mr = copyTextureOf(doc, src.getMetallicRoughnessTexture(), cache);
  if (mr) {
    dst.setMetallicRoughnessTexture(mr);
    copyTextureInfo(src.getMetallicRoughnessTextureInfo(), dst.getMetallicRoughnessTextureInfo());
  }
  const nrm = copyTextureOf(doc, src.getNormalTexture(), cache);
  if (nrm) {
    dst.setNormalTexture(nrm);
    copyTextureInfo(src.getNormalTextureInfo(), dst.getNormalTextureInfo());
  }
  const occ = copyTextureOf(doc, src.getOcclusionTexture(), cache);
  if (occ) {
    dst.setOcclusionTexture(occ);
    copyTextureInfo(src.getOcclusionTextureInfo(), dst.getOcclusionTextureInfo());
  }
  const emi = copyTextureOf(doc, src.getEmissiveTexture(), cache);
  if (emi) {
    dst.setEmissiveTexture(emi);
    copyTextureInfo(src.getEmissiveTextureInfo(), dst.getEmissiveTextureInfo());
  }
}

function glbJsonChunk(bytes: Buffer): string {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return bytes.subarray(20, 20 + dv.getUint32(12, true)).toString('utf8');
}

/** Rewrites the GLB JSON chunk so webp images carry a declared EXT_texture_webp. */
function declareTextureWebp(glb: Buffer): Buffer {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: { mimeType?: string }[];
    textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
    extensionsUsed?: string[];
  };
  const hasWebp = json.images?.some((image) => image.mimeType === 'image/webp');
  if (!hasWebp) return glb;
  const used = json.extensionsUsed ?? [];
  if (!used.includes('EXT_texture_webp')) used.push('EXT_texture_webp');
  json.extensionsUsed = used;
  for (const texture of json.textures ?? []) {
    if (texture.source === undefined) continue;
    texture.extensions = {
      ...(texture.extensions ?? {}),
      EXT_texture_webp: { source: texture.source },
    };
  }
  let chunk = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (chunk.length % 4)) % 4;
  if (pad > 0) chunk = Buffer.concat([chunk, Buffer.alloc(pad, 0x20)]);
  const rest = glb.subarray(20 + jsonLen);
  const total = 12 + 8 + chunk.length + rest.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(chunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  chunk.copy(out, 20);
  rest.copy(out, 20 + chunk.length);
  return out;
}

/** renameSync so parallel workers never observe a torn output file. */
function writeAtomic(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp-${process.pid}-${Math.floor(performance.now() * 1000)}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function rotationFor(forward: CarPipelineConfig['forward']): { c: number; s: number } {
  switch (forward) {
    case '-z':
      return { c: 1, s: 0 };
    case '+z':
      return { c: -1, s: 0 };
    case '+x':
      return { c: 0, s: 1 };
    case '-x':
      return { c: 0, s: -1 };
  }
}

function loadConfig(id: string): CarPipelineConfig {
  const path = join(CONFIG_DIR, `${id}.pipeline.json`);
  if (!existsSync(path)) throw new Error(`unknown car id: ${id}`);
  return JSON.parse(readFileSync(path, 'utf8')) as CarPipelineConfig;
}

function configIds(): string[] {
  return readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith('.pipeline.json'))
    .map((f) => f.slice(0, -'.pipeline.json'.length))
    .sort();
}

async function buildGeneric(config: CarPipelineConfig): Promise<void> {
  if (!config.wheelNodes?.length && !config.wheelMaterials?.length) {
    throw new Error('config must give wheelNodes or wheelMaterials');
  }
  const io = new NodeIO().registerExtensions([KHRTextureTransform]);
  const srcDoc = await io.read(join(ROOT, config.source));
  const wheelEntries = config.wheelNodes?.length ? parseWheelNodes(config.wheelNodes) : [];
  const wheelMaterials = config.wheelMaterials ?? [];
  const maxTextureSize = config.maxTextureSize ?? 1024;

  const roleOf = new Map<string, Role>();
  const tyreOf = new Map<string, boolean>();
  const colourOf = new Map<string, vec4>();
  const materialOf = new Map<string, Material>();
  const bodyKeys: string[] = [];
  for (const material of srcDoc.getRoot().listMaterials()) {
    const name = material.getName();
    // Livery wins so a wheel pattern like "redpand" cannot swallow "redpand.001".
    const role: Role = matches(name, config.liveryMaterials)
      ? 'livery'
      : matches(name, wheelMaterials)
        ? 'wheel'
        : 'body';
    roleOf.set(name, role);
    tyreOf.set(name, /tyre|rubber/i.test(name));
    colourOf.set(name, material.getBaseColorFactor());
    materialOf.set(name, material);
    if (role === 'body') bodyKeys.push(name);
  }

  const dropNodes = new Set(config.dropNodes ?? []);
  srcDoc
    .getRoot()
    .listScenes()[0]
    .traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh || !dropNodes.has(node.getName())) return;
      node.setMesh(null);
      if (!mesh.listParents().some((parent) => parent instanceof Node)) mesh.dispose();
    });

  const usersOf = new Map<Mesh, Node[]>();
  srcDoc
    .getRoot()
    .listScenes()[0]
    .traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const list = usersOf.get(mesh);
      if (list) list.push(node);
      else usersOf.set(mesh, [node]);
    });

  // Snapshot pristine geometry first: Mesh.clone() shares accessors, so cloning a
  // mesh after any bake would re-apply the first node's matrix on top of the next.
  const originals = srcDoc.getRoot().listMeshes().slice();
  const pristine = new Map<Mesh, Mesh>();
  for (const mesh of originals) pristine.set(mesh, cloneMeshDeep(srcDoc, mesh));

  for (const mesh of originals) {
    const snap = pristine.get(mesh) as Mesh;
    const users = usersOf.get(mesh) ?? [];
    for (const node of users) {
      // transformPrimitive already reverses winding when det(matrix) < 0.
      const target = cloneMeshDeep(srcDoc, snap);
      transformMesh(target, node.getWorldMatrix());
      for (const prim of target.listPrimitives()) {
        weldPositions(prim, hasTexture(prim.getMaterial()));
      }
      node.setMesh(target);
    }
    snap.dispose();
    if (users.length > 0) mesh.dispose();
  }

  // wheelNodes may name an ancestor group; inherit the match down to the mesh node.
  const wheelClassOf = new Map<Mesh, 'tyre' | 'rim'>();
  if (wheelEntries.length > 0) {
    const walk = (node: Node, inherited: 'tyre' | 'rim' | null): void => {
      const cls = matchWheelNode(node.getName(), wheelEntries) ?? inherited;
      const mesh = node.getMesh();
      if (mesh && cls && !wheelClassOf.has(mesh)) wheelClassOf.set(mesh, cls);
      for (const child of node.listChildren()) walk(child, cls);
    };
    for (const child of srcDoc.getRoot().listScenes()[0].listChildren()) walk(child, null);
  }

  const pieces: Piece[] = [];
  for (const mesh of srcDoc.getRoot().listMeshes()) {
    const cls = wheelClassOf.get(mesh) ?? null;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) throw new Error(`primitive of ${mesh.getName()} is not TRIANGLES`);
      const material = prim.getMaterial();
      const source = material?.getName() ?? '';
      const role = cls ? 'wheel' : roleOf.get(source);
      if (!role) throw new Error(`unmapped material ${source}`);
      pieces.push({
        geom: readGeom(prim, 1, hasTexture(material)),
        role,
        isTyre: cls ? cls === 'tyre' : (tyreOf.get(source) ?? false),
        source,
      });
    }
  }

  const { c, s } = rotationFor(config.forward);
  for (const piece of pieces) rotateGeomY(piece.geom, c, s);

  const world = unionBounds(pieces.map((p) => p.geom));
  const length = world.max[2] - world.min[2];
  if (!(length > 0)) throw new Error('source has no length along z');
  const scale = config.targetLength / length;
  for (const piece of pieces) scaleGeom(piece.geom, scale);

  const wheelPieces = pieces.filter((p) => p.role === 'wheel');
  const bodyPieces = pieces.filter((p) => p.role !== 'wheel');
  if (wheelPieces.length === 0) throw new Error('no wheel geometry matched');

  const wheelBounds = unionBounds(wheelPieces.map((p) => p.geom));
  const xSplit = (wheelBounds.min[0] + wheelBounds.max[0]) / 2;
  const zSplit = (wheelBounds.min[2] + wheelBounds.max[2]) / 2;

  const cornerTyre = new Map<WheelName, Geom[]>();
  const cornerRim = new Map<WheelName, Geom[]>();
  for (const name of WHEEL_NODE_NAMES) {
    cornerTyre.set(name, []);
    cornerRim.set(name, []);
  }
  for (const piece of wheelPieces) {
    const quads = splitByQuadrant(piece.geom, xSplit, zSplit);
    for (const name of WHEEL_NODE_NAMES) {
      const g = quads.get(name) as Geom;
      if (g.index.length === 0) continue;
      (piece.isTyre ? cornerTyre : cornerRim).get(name)?.push(g);
    }
  }

  const cornerAll = new Map<WheelName, Geom[]>();
  const hubs = new Map<WheelName, [number, number, number]>();
  for (const name of WHEEL_NODE_NAMES) {
    const all = [...(cornerTyre.get(name) as Geom[]), ...(cornerRim.get(name) as Geom[])];
    if (all.length === 0) throw new Error(`no wheel geometry for ${name}`);
    cornerAll.set(name, all);
    hubs.set(name, bboxCentre(unionBounds(all)));
  }

  const hubList = WHEEL_NODE_NAMES.map((n) => hubs.get(n) as [number, number, number]);
  const xOrigin = hubList.reduce((sum, h) => sum + h[0], 0) / hubList.length;
  const zOrigin = hubList.reduce((sum, h) => sum + h[2], 0) / hubList.length;
  const yOrigin = Math.min(
    ...WHEEL_NODE_NAMES.map((n) => unionBounds(cornerAll.get(n) as Geom[]).min[1]),
  );

  for (const piece of bodyPieces) translateGeom(piece.geom, -xOrigin, -yOrigin, -zOrigin);

  const wheelMeta: { name: WheelName; x: number; y: number; z: number }[] = [];
  for (const name of WHEEL_NODE_NAMES) {
    const hub = hubs.get(name) as [number, number, number];
    for (const g of cornerAll.get(name) as Geom[]) translateGeom(g, -hub[0], -hub[1], -hub[2]);
    wheelMeta.push({
      name,
      x: hub[0] - xOrigin,
      y: hub[1] - yOrigin,
      z: hub[2] - zOrigin,
    });
  }

  const bodyGroups = new Map<string, Geom[]>();
  bodyGroups.set('livery', []);
  for (const key of bodyKeys) bodyGroups.set(key, []);
  for (const piece of bodyPieces) {
    const key = piece.role === 'livery' ? 'livery' : piece.source;
    bodyGroups.get(key)?.push(piece.geom);
  }

  const doc = new Document();
  const materials = new Map<string, Material>();
  const livery = doc.createMaterial('livery').setBaseColorFactor(LIVERY_COLOUR);
  materials.set('livery', livery);
  const firstTyre = wheelPieces.find((p) => p.isTyre);
  const firstRim = wheelPieces.find((p) => !p.isTyre);
  if (firstTyre) {
    materials.set(
      'tyre',
      doc.createMaterial('tyre').setBaseColorFactor(colourOf.get(firstTyre.source) ?? DEFAULT_COLOUR),
    );
  }
  if (firstRim) {
    materials.set(
      'rim',
      doc.createMaterial('rim').setBaseColorFactor(colourOf.get(firstRim.source) ?? DEFAULT_COLOUR),
    );
  }
  const texCache = new Map<Texture, Texture>();
  bodyKeys.forEach((key, i) => {
    const srcMat = materialOf.get(key);
    const dst = doc
      .createMaterial(`body_${i}`)
      .setBaseColorFactor(colourOf.get(key) ?? DEFAULT_COLOUR);
    if (srcMat && !matches(key, config.neutralMaterials ?? [])) copyBodyTextures(doc, srcMat, dst, texCache);
    materials.set(`body_${i}`, dst);
  });

  const scene = doc.createScene('Scene');
  const bodyNode = doc.createNode('body');
  const bodyMesh = doc.createMesh('body');
  const liveryPrims: Primitive[] = [];
  const tyrePrims: Primitive[] = [];
  const rimPrims: Primitive[] = [];
  if ((bodyGroups.get('livery') as Geom[]).length > 0) {
    const prim = createPrim(doc, mergeGeoms(bodyGroups.get('livery') as Geom[]), livery);
    liveryPrims.push(prim);
    bodyMesh.addPrimitive(prim);
  }
  bodyKeys.forEach((key, i) => {
    const geoms = bodyGroups.get(key) as Geom[];
    if (geoms.length === 0) return;
    bodyMesh.addPrimitive(
      createPrim(doc, mergeGeoms(geoms), materials.get(`body_${i}`) as Material),
    );
  });
  bodyNode.setMesh(bodyMesh);
  scene.addChild(bodyNode);

  for (const meta of wheelMeta) {
    const node = doc.createNode(meta.name);
    const mesh = doc.createMesh(meta.name);
    const tyreGeoms = cornerTyre.get(meta.name) as Geom[];
    const rimGeoms = cornerRim.get(meta.name) as Geom[];
    if (tyreGeoms.length > 0) {
      const prim = createPrim(doc, mergeGeoms(tyreGeoms), materials.get('tyre') as Material);
      tyrePrims.push(prim);
      mesh.addPrimitive(prim);
    }
    if (rimGeoms.length > 0) {
      const prim = createPrim(doc, mergeGeoms(rimGeoms), materials.get('rim') as Material);
      rimPrims.push(prim);
      mesh.addPrimitive(prim);
    }
    node.setMesh(mesh);
    node.setTranslation([meta.x, meta.y, meta.z]);
    scene.addChild(node);
  }

  await MeshoptSimplifier.ready;
  const allPrims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  let total = triCount(allPrims);
  if (total > config.triBudget) {
    const wheelPrims = wheelMeta.flatMap((m) =>
      doc
        .getRoot()
        .listScenes()[0]
        .listChildren()
        .find((n) => n.getName() === m.name)
        ?.getMesh()
        ?.listPrimitives() ?? [],
    );
    const bodyPrims = allPrims.filter((p) => !wheelPrims.includes(p));
    const wheelCap = config.wheelTriBudget;
    if (wheelCap !== undefined && triCount(wheelPrims) > wheelCap) {
      // wheel quadrant splits are triangle soup; weld first so the simplifier can collapse edges
      await doc.transform(weld());
      const ratio = wheelCap / triCount(wheelPrims);
      for (const prim of wheelPrims) {
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR });
      }
    }
    for (let pass = 0; pass < 8 && total > config.triBudget; pass++) {
      const wheelTris = triCount(wheelPrims);
      const bodyTris = triCount(bodyPrims);
      if (bodyTris > 0 && wheelTris < config.triBudget) {
        const ratio = Math.min(1, ((config.triBudget - wheelTris) / bodyTris) * 0.97);
        for (const prim of bodyPrims) {
          simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR });
        }
      } else {
        const ratio = Math.min(1, ((config.triBudget / total) * 0.97));
        for (const prim of allPrims) {
          simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: SIMPLIFY_ERROR });
        }
      }
      total = triCount(allPrims);
    }
  }

  // keepSolidTextures: legitimate livery/tyre maps are often flat colours.
  await doc.transform(weld(), dedup(), prune({ keepSolidTextures: true }));
  // dedup merges materials by properties, which can swallow named roles into a same-colour twin.
  const stillMissing = (name: string) =>
    !doc.getRoot().listMaterials().some((m) => m.getName() === name);
  if (liveryPrims.length > 0 && stillMissing('livery')) {
    const restored = doc.createMaterial('livery').setBaseColorFactor(LIVERY_COLOUR);
    for (const prim of liveryPrims) prim.setMaterial(restored);
  }
  if (tyrePrims.length > 0 && stillMissing('tyre')) {
    const restored = doc
      .createMaterial('tyre')
      .setBaseColorFactor(colourOf.get(firstTyre?.source ?? '') ?? DEFAULT_COLOUR);
    for (const prim of tyrePrims) prim.setMaterial(restored);
  }
  if (rimPrims.length > 0 && stillMissing('rim')) {
    const restored = doc
      .createMaterial('rim')
      .setBaseColorFactor(colourOf.get(firstRim?.source ?? '') ?? DEFAULT_COLOUR);
    for (const prim of rimPrims) prim.setMaterial(restored);
  }
  const outTextures = doc.getRoot().listTextures();
  if (outTextures.length > 0) {
    for (const t of outTextures) {
      if (!t.getMimeType()) {
        const image = t.getImage();
        if (image) t.setMimeType(sniffMime(image));
      }
    }
    await doc.transform(
      textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        resize: [maxTextureSize, maxTextureSize],
      }),
    );
    doc.getRoot().listTextures().forEach((t, i) => {
      t.setName(`tex_${i}`);
      t.setURI('');
    });
    for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
  }
  const asset = doc.getRoot().getAsset();
  if (asset.extras !== undefined) delete asset.extras;
  const triangles = triCount(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()));
  if (triangles > config.triBudget) {
    throw new Error(`triangle budget exceeded: ${triangles} > ${config.triBudget}`);
  }

  const radii: number[] = [];
  for (const name of WHEEL_NODE_NAMES) {
    const geoms = (cornerTyre.get(name) as Geom[]).length
      ? (cornerTyre.get(name) as Geom[])
      : (cornerAll.get(name) as Geom[]);
    const b = unionBounds(geoms);
    radii.push((b.max[1] - b.min[1]) / 2);
  }
  const wheelRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const fl = wheelMeta.find((w) => w.name === 'wheel-front-left') as { x: number; z: number };
  const fr = wheelMeta.find((w) => w.name === 'wheel-front-right') as { x: number; z: number };
  const bl = wheelMeta.find((w) => w.name === 'wheel-back-left') as { x: number; z: number };
  const br = wheelMeta.find((w) => w.name === 'wheel-back-right') as { x: number; z: number };
  const zFront = (fl.z + fr.z) / 2;
  const zRear = (bl.z + br.z) / 2;

  // 071 POST6/POST7 pin builds whose livery patterns matched nothing as successful and
  // without a livery material, so those cars name their largest body material instead.
  const materialTriangles = new Map<string, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '';
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      const n = idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
      materialTriangles.set(name, (materialTriangles.get(name) ?? 0) + n);
    }
  }
  const bySize = (a: [string, number], b: [string, number]): number => b[1] - a[1];
  const bodyPick = [...materialTriangles.entries()].filter(([n]) => /^body_\d+$/.test(n)).sort(bySize)[0];
  const wheelPick = [...materialTriangles.entries()]
    .filter(([n]) => n === 'rim' || n === 'tyre')
    .sort(bySize)[0];
  const paintMaterials = doc.getRoot().listMaterials().some((m) => m.getName() === 'livery')
    ? ['livery']
    : [bodyPick ? bodyPick[0] : (wheelPick?.[0] ?? 'rim')];
  const meta = {
    paintMaterials,
    wheelRadius: round6(wheelRadius),
    wheelbase: round6(Math.abs(zFront - zRear)),
    trackFront: round6(Math.abs(fr.x - fl.x)),
    trackRear: round6(Math.abs(br.x - bl.x)),
    wheels: wheelMeta.map((w) => ({
      name: w.name,
      x: round6(w.x),
      y: round6(w.y),
      z: round6(w.z),
    })),
  };

  const outGlb = join(ROOT, config.outGlb);
  const outJson = join(ROOT, config.outJson);
  mkdirSync(dirname(outGlb), { recursive: true });
  mkdirSync(dirname(outJson), { recursive: true });
  writeAtomic(outGlb, declareTextureWebp(Buffer.from(await io.writeBinary(doc))));
  writeAtomic(outJson, `${JSON.stringify(meta, null, 2)}\n`);

  // Texture bytes are excluded (known limitation); names and extras must be clean.
  const glbStrings = glbJsonChunk(readFileSync(outGlb)).toLowerCase();
  const json = readFileSync(outJson, 'utf8').toLowerCase();
  for (const brand of FORBIDDEN) {
    if (glbStrings.includes(brand) || json.includes(brand)) {
      throw new Error(`forbidden name ${brand} leaked into the output`);
    }
  }

  console.log(`wrote ${config.outGlb} (${triangles} triangles) and ${config.outJson}`);
}

export async function buildCar(id: string): Promise<void> {
  const config = loadConfig(id);
  if (!(config.targetLength > 0)) {
    throw new Error(`targetLength must be positive: ${config.targetLength}`);
  }
  if (!existsSync(join(ROOT, config.source))) {
    throw new Error(`missing source: ${config.source}`);
  }
  if (id === 'f4') {
    // f4 keeps the 053 pipeline (scale 1.47, split by x sign); only paths and budget come from config.
    await buildF4({
      source: join(ROOT, config.source),
      outGlb: join(ROOT, config.outGlb),
      outJson: join(ROOT, config.outJson),
      triBudget: config.triBudget,
    });
    return;
  }
  await buildGeneric(config);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const args = process.argv.slice(2);
  const ids = args.length > 0 ? args : configIds();
  (async () => {
    for (const id of ids) await buildCar(id);
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

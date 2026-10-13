import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  type vec4,
} from '@gltf-transform/core';
import { dedup, prune, simplify, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SOURCE = join(ROOT, 'assets', 'vendor', 'f4', 'f4_tatuus_t014_chasis.glb');
const DEFAULT_OUT_GLB = join(ROOT, 'public', 'models', 'f4.glb');
const DEFAULT_OUT_JSON = join(ROOT, 'public', 'models', 'f4.json');

const MODEL_SCALE = 1.47;
const WHEEL_NODE_NAMES = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
] as const;

type MaterialKey = 'livery' | 'tyre' | 'disc' | 'caliper';
type WheelName = (typeof WHEEL_NODE_NAMES)[number];

const SOURCE_TO_MATERIAL: Record<string, MaterialKey> = {
  Cubo_008: 'livery',
  neumaticos: 'tyre',
  GrisFreno: 'disc',
  GrisMordaza: 'caliper',
};

const LIVERY_COLOUR: vec4 = [200 / 255, 16 / 255, 46 / 255, 1];
const DEFAULT_COLOUR: vec4 = [0.5, 0.5, 0.5, 1];
const SIMPLIFY_RATIO = 0.2;
const SIMPLIFY_ERROR = 0.02;
const DEFAULT_TRI_BUDGET = 80_000;
const MIN_TYRE_RADIAL_SEGMENTS = 24;

export interface BuildF4Options {
  source?: string;
  outGlb?: string;
  outJson?: string;
  triBudget?: number;
}

interface Geom {
  position: number[];
  normal: number[];
  index: number[];
}

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

function emptyGeom(): Geom {
  return { position: [], normal: [], index: [] };
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

function translateGeom(g: Geom, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < g.position.length; i += 3) {
    g.position[i] += dx;
    g.position[i + 1] += dy;
    g.position[i + 2] += dz;
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
    for (let i = 0; i < g.index.length; i++) out.index.push(g.index[i] + base);
  }
  return out;
}

/** Splits triangles by the x sign of their centroid; left is x < 0. */
function splitByXSign(g: Geom): { left: Geom; right: Geom } {
  const left = emptyGeom();
  const right = emptyGeom();
  for (let t = 0; t < g.index.length; t += 3) {
    const a = g.index[t] * 3;
    const b = g.index[t + 1] * 3;
    const c = g.index[t + 2] * 3;
    const cx = (g.position[a] + g.position[b] + g.position[c]) / 3;
    const dst = cx < 0 ? left : right;
    const base = dst.position.length / 3;
    for (let k = 0; k < 3; k++) {
      const vi = g.index[t + k];
      dst.position.push(g.position[vi * 3], g.position[vi * 3 + 1], g.position[vi * 3 + 2]);
      dst.normal.push(g.normal[vi * 3], g.normal[vi * 3 + 1], g.normal[vi * 3 + 2]);
      dst.index.push(base + k);
    }
  }
  return { left, right };
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

/**
 * Merges vertices that share a position, averaging normals. Hard-edge splits would
 * otherwise block meshoptimizer simplification (topology seams).
 */
function weldPositions(prim: Primitive): void {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const idx = prim.getIndices();
  if (!pos || !nrm || !idx) throw new Error('primitive missing POSITION, NORMAL or indices');
  const pa = pos.getArray() as Float32Array;
  const na = nrm.getArray() as Float32Array;
  const ia = idx.getArray() as Uint16Array | Uint32Array;
  const remap = new Uint32Array(pa.length / 3);
  const byKey = new Map<string, number>();
  const newPos: number[] = [];
  const newNrm: number[] = [];
  for (let i = 0; i < pa.length / 3; i++) {
    const key = `${pa[i * 3]} ${pa[i * 3 + 1]} ${pa[i * 3 + 2]}`;
    let target = byKey.get(key);
    if (target === undefined) {
      target = newPos.length / 3;
      byKey.set(key, target);
      newPos.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      newNrm.push(0, 0, 0);
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
  idx.setArray(out);
}

function readGeom(prim: Primitive): Geom {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const idx = prim.getIndices();
  if (!pos || !nrm) throw new Error('primitive missing POSITION or NORMAL');
  const posArr = pos.getArray() as Float32Array;
  const nrmArr = nrm.getArray() as Float32Array;
  const out = emptyGeom();
  for (let i = 0; i < posArr.length; i += 3) {
    out.position.push(
      posArr[i] * MODEL_SCALE,
      posArr[i + 1] * MODEL_SCALE,
      posArr[i + 2] * MODEL_SCALE,
    );
    out.normal.push(nrmArr[i], nrmArr[i + 1], nrmArr[i + 2]);
  }
  if (idx) {
    for (const v of idx.getArray() as Uint16Array | Uint32Array) out.index.push(v);
  } else {
    for (let v = 0; v < posArr.length / 3; v++) out.index.push(v);
  }
  return out;
}

/** Distinct tread angles around the wheel axis, as counted by the acceptance edge tests. */
function tyreRadialSegments(g: Geom): number {
  let maxR = 0;
  for (let i = 0; i < g.position.length; i += 3) {
    maxR = Math.max(maxR, Math.hypot(g.position[i + 1], g.position[i + 2]));
  }
  const angles = new Set<number>();
  for (let i = 0; i < g.position.length; i += 3) {
    const y = g.position[i + 1];
    const z = g.position[i + 2];
    if (Math.hypot(y, z) < 0.85 * maxR) continue;
    angles.add(Math.round((Math.atan2(z, y) * 180) / Math.PI));
  }
  return angles.size;
}

function createPrim(doc: Document, g: Geom, material: Material): Primitive {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc.createPrimitive();
  prim.setAttribute(
    'POSITION',
    doc
      .createAccessor()
      .setBuffer(buffer)
      .setType('VEC3')
      .setArray(new Float32Array(g.position)),
  );
  prim.setAttribute(
    'NORMAL',
    doc
      .createAccessor()
      .setBuffer(buffer)
      .setType('VEC3')
      .setArray(new Float32Array(g.normal)),
  );
  prim.setIndices(
    doc
      .createAccessor()
      .setBuffer(buffer)
      .setType('SCALAR')
      .setArray(new Uint32Array(g.index)),
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

export async function buildF4(options: BuildF4Options = {}): Promise<void> {
  const source = options.source ?? DEFAULT_SOURCE;
  const outGlb = options.outGlb ?? DEFAULT_OUT_GLB;
  const outJson = options.outJson ?? DEFAULT_OUT_JSON;
  const triBudget = options.triBudget ?? DEFAULT_TRI_BUDGET;
  const io = new NodeIO();
  const srcDoc = await io.read(source);

  // Bake node transforms so vertex positions are in world axes before any split.
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
      for (const prim of target.listPrimitives()) weldPositions(prim);
      node.setMesh(target);
    }
    snap.dispose();
    if (users.length > 0) mesh.dispose();
  }

  await MeshoptSimplifier.ready;
  await srcDoc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY_RATIO, error: SIMPLIFY_ERROR }),
    dedup(),
    prune(),
  );

  const sourceColours = new Map<string, vec4>();
  for (const material of srcDoc.getRoot().listMaterials()) {
    sourceColours.set(material.getName(), material.getBaseColorFactor());
  }

  const bodyLivery: Geom[] = [];
  const bodyCaliper: Geom[] = [];
  const cornerTyre = new Map<WheelName, Geom>();
  const cornerDisc = new Map<WheelName, Geom>();

  for (const mesh of srcDoc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const sourceName = prim.getMaterial()?.getName();
      const key = sourceName ? SOURCE_TO_MATERIAL[sourceName] : undefined;
      if (!key) throw new Error(`unmapped material ${sourceName ?? '<none>'}`);
      if (prim.getMode() !== 4) throw new Error(`primitive of ${mesh.getName()} is not TRIANGLES`);
      const g = readGeom(prim);
      if (key === 'livery' || key === 'caliper') {
        (key === 'livery' ? bodyLivery : bodyCaliper).push(g);
        continue;
      }
      const { left, right } = splitByXSign(g);
      for (const part of [left, right]) {
        if (part.index.length === 0) throw new Error(`empty half while splitting ${mesh.getName()}`);
        const centre = bboxCentre(geomBounds(part));
        const side = centre[0] < 0 ? 'left' : 'right';
        const axle = centre[2] < 0 ? 'front' : 'back';
        const corner = `wheel-${axle}-${side}` as WheelName;
        const store = key === 'tyre' ? cornerTyre : cornerDisc;
        if (store.has(corner)) throw new Error(`duplicate ${key} geometry for ${corner}`);
        store.set(corner, part);
      }
    }
  }

  for (const name of WHEEL_NODE_NAMES) {
    if (!cornerTyre.has(name) || !cornerDisc.has(name)) {
      throw new Error(`missing tyre or disc geometry for ${name}`);
    }
  }

  // Origin on the ground under the axle midpoint, x centred. Left = -x, front = -z.
  const tyreBounds = WHEEL_NODE_NAMES.map((name) => geomBounds(cornerTyre.get(name) as Geom));
  const hubs = tyreBounds.map((b) => bboxCentre(b));
  const wheelRadius =
    tyreBounds.reduce((sum, b) => sum + (b.max[1] - b.min[1]) / 2, 0) / WHEEL_NODE_NAMES.length;
  const minTyreY = Math.min(...tyreBounds.map((b) => b.min[1]));
  const xMid = hubs.reduce((s, c) => s + c[0], 0) / hubs.length;
  const zMid = hubs.reduce((s, c) => s + c[2], 0) / hubs.length;

  for (const g of [...bodyLivery, ...bodyCaliper]) translateGeom(g, -xMid, -minTyreY, -zMid);

  const wheelMeta: { name: WheelName; x: number; y: number; z: number }[] = [];
  for (const [i, name] of WHEEL_NODE_NAMES.entries()) {
    const hub = hubs[i];
    for (const g of [cornerTyre.get(name) as Geom, cornerDisc.get(name) as Geom]) {
      translateGeom(g, -hub[0], -hub[1], -hub[2]);
    }
    wheelMeta.push({
      name,
      x: hub[0] - xMid,
      y: hub[1] - minTyreY,
      z: hub[2] - zMid,
    });
  }

  const doc = new Document();
  const materials = new Map<MaterialKey, Material>();
  for (const [sourceName, key] of Object.entries(SOURCE_TO_MATERIAL)) {
    const material = doc.createMaterial(key);
    material.setBaseColorFactor(
      key === 'livery' ? LIVERY_COLOUR : (sourceColours.get(sourceName) ?? DEFAULT_COLOUR),
    );
    materials.set(key, material);
  }

  const scene = doc.createScene('Scene');

  const bodyNode = doc.createNode('body');
  const bodyMesh = doc.createMesh('body');
  bodyMesh.addPrimitive(
    createPrim(doc, mergeGeoms(bodyLivery), materials.get('livery') as Material),
  );
  bodyMesh.addPrimitive(
    createPrim(doc, mergeGeoms(bodyCaliper), materials.get('caliper') as Material),
  );
  bodyNode.setMesh(bodyMesh);
  scene.addChild(bodyNode);

  for (const [i, name] of WHEEL_NODE_NAMES.entries()) {
    const node = doc.createNode(name);
    const mesh = doc.createMesh(name);
    mesh.addPrimitive(createPrim(doc, cornerTyre.get(name) as Geom, materials.get('tyre') as Material));
    mesh.addPrimitive(createPrim(doc, cornerDisc.get(name) as Geom, materials.get('disc') as Material));
    node.setMesh(mesh);
    node.setTranslation([wheelMeta[i].x, wheelMeta[i].y, wheelMeta[i].z]);
    scene.addChild(node);
  }

  await doc.transform(weld(), dedup(), prune());

  const meshPrims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const triangles = triCount(meshPrims);
  if (triangles > triBudget) throw new Error(`triangle budget exceeded: ${triangles}`);

  for (const name of WHEEL_NODE_NAMES) {
    const node = doc
      .getRoot()
      .listScenes()[0]
      .listChildren()
      .find((n) => n.getName() === name);
    const tyrePrim = node?.getMesh()?.listPrimitives()[0];
    if (!tyrePrim) throw new Error(`missing wheel node ${name}`);
    const segments = tyreRadialSegments(readGeom(tyrePrim));
    if (segments < MIN_TYRE_RADIAL_SEGMENTS) {
      throw new Error(`${name} tyre has only ${segments} radial segments`);
    }
  }

  const meta = {
    wheelRadius: round6(wheelRadius),
    wheelbase: round6(Math.abs(wheelMeta[0].z - wheelMeta[2].z)),
    trackFront: round6(Math.abs(wheelMeta[1].x - wheelMeta[0].x)),
    trackRear: round6(Math.abs(wheelMeta[3].x - wheelMeta[2].x)),
    wheels: wheelMeta.map((w) => ({
      name: w.name,
      x: round6(w.x),
      y: round6(w.y),
      z: round6(w.z),
    })),
  };

  mkdirSync(dirname(outGlb), { recursive: true });
  writeFileSync(outGlb, await io.writeBinary(doc));
  writeFileSync(outJson, `${JSON.stringify(meta, null, 2)}\n`);

  const glb = readFileSync(outGlb).toString('latin1').toLowerCase();
  const json = readFileSync(outJson, 'utf8').toLowerCase();
  if (glb.includes('tatuus') || json.includes('tatuus')) {
    throw new Error('forbidden name leaked into the output');
  }

  console.log(`wrote ${outGlb} (${triangles} triangles) and ${outJson}`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  buildF4().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

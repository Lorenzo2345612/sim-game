import * as THREE from 'three';
import type { CityEnv } from '../core/types';

export const CITY_CELL = 200; // metres

const FACADE_FLOOR = 3.2; // metres per facade row
const FACADE_TILE = 4; // metres per horizontal texture tile
const WATER_TILE = 8;
const WATER_DROP = 0.3; // metres below the terrain minimum
const WATER_SCROLL = 0.02; // normal-map uv offset per second
const CONCRETE_TINT = 0x9a9a9a;
const WATER_COLOR = 0x2a5a8c;

type P2 = [number, number];

export interface CityObject {
  group: THREE.Group;
  buildings: number;
  update(timeSeconds: number): void;
  dispose(): void;
}

interface GeoBucket {
  positions: number[];
  uvs: number[];
}

interface TexSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
}

// Copy of the ring: drop consecutive duplicates and the closing point, orient CCW in
// (x, z) so wall faces point outward and ShapeUtils gets a well-formed contour.
function orientedRing(ring: readonly P2[]): P2[] {
  const pts: P2[] = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push([p[0], p[1]]);
  }
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
    pts.pop();
  }
  let area2 = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area2 += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  if (area2 < 0) pts.reverse();
  return pts;
}

function distinctCount(pts: readonly P2[]): number {
  const seen = new Set<string>();
  for (const p of pts) seen.add(`${p[0]},${p[1]}`);
  return seen.size;
}

function pushVertex(
  bucket: GeoBucket,
  x: number,
  y: number,
  z: number,
  u: number,
  v: number,
): void {
  bucket.positions.push(x, y, z);
  bucket.uvs.push(u, v);
}

function pushTri(
  bucket: GeoBucket,
  a: [number, number, number, number, number],
  b: [number, number, number, number, number],
  c: [number, number, number, number, number],
): void {
  pushVertex(bucket, a[0], a[1], a[2], a[3], a[4]);
  pushVertex(bucket, b[0], b[1], b[2], b[3], b[4]);
  pushVertex(bucket, c[0], c[1], c[2], c[3], c[4]);
}

function geometryFrom(bucket: GeoBucket): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

// Flat triangle wound CW in (x, z) so the face points +Y.
function pushFlatTri(
  bucket: GeoBucket,
  p0: P2,
  p1: P2,
  p2: P2,
  y: number,
  uvScale: number,
): void {
  const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  const order = cross < 0 ? [p0, p1, p2] : [p0, p2, p1];
  for (const p of order) {
    pushVertex(bucket, p[0], y, p[1], p[0] / uvScale, p[1] / uvScale);
  }
}

function emitFlat(bucket: GeoBucket, pts: P2[], y: number, uvScale: number): void {
  if (pts.length < 3) return;
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  for (const face of THREE.ShapeUtils.triangulateShape(contour, [])) {
    const [i0, i1, i2] = face;
    pushFlatTri(bucket, pts[i0], pts[i1], pts[i2], y, uvScale);
  }
}

function bucketGeometry(bucket: GeoBucket): THREE.BufferGeometry | null {
  if (bucket.positions.length === 0) return null;
  return geometryFrom(bucket);
}

export function extrudeBuilding(
  ring: [number, number][],
  height: number,
  baseY: number,
): THREE.BufferGeometry {
  const pts = orientedRing(ring);
  const bucket: GeoBucket = { positions: [], uvs: [] };
  if (distinctCount(pts) >= 3) {
    const top = baseY + height;
    const vTop = height / FACADE_FLOOR;
    let perimeter = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const u0 = (dist % perimeter) / FACADE_TILE;
      dist += Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u1 = (dist % perimeter) / FACADE_TILE;
      // CCW ring: (A0, B1, B0) and (A0, A1, B1) face outward.
      pushTri(
        bucket,
        [a[0], baseY, a[1], u0, 0],
        [b[0], top, b[1], u1, vTop],
        [b[0], baseY, b[1], u1, 0],
      );
      pushTri(
        bucket,
        [a[0], baseY, a[1], u0, 0],
        [a[0], top, a[1], u0, vTop],
        [b[0], top, b[1], u1, vTop],
      );
    }
    // Roof: flat top at XZ / 4.
    emitFlat(bucket, pts, top, FACADE_TILE);
  }
  return geometryFrom(bucket);
}

// Per-segment box strip: 4 vertical faces + top, no bottom.
function emitWallStrip(
  bucket: GeoBucket,
  a: P2,
  b: P2,
  baseY: number,
  height: number,
  halfWidth: number,
): void {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len === 0) return;
  const nx = (-dz / len) * halfWidth;
  const nz = (dx / len) * halfWidth;
  const top = baseY + height;
  const vTop = height / FACADE_FLOOR;
  // CCW cross-section ring so the outward wall formula faces away from the strip.
  const ring: P2[] = [
    [a[0] + nx, a[1] + nz],
    [a[0] - nx, a[1] - nz],
    [b[0] - nx, b[1] - nz],
    [b[0] + nx, b[1] + nz],
  ];
  let u = 0;
  for (let i = 0; i < 4; i++) {
    const c0 = ring[i];
    const c1 = ring[(i + 1) % 4];
    const u0 = u / FACADE_TILE;
    u += Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    const u1 = u / FACADE_TILE;
    pushTri(
      bucket,
      [c0[0], baseY, c0[1], u0, 0],
      [c1[0], top, c1[1], u1, vTop],
      [c1[0], baseY, c1[1], u1, 0],
    );
    pushTri(
      bucket,
      [c0[0], baseY, c0[1], u0, 0],
      [c0[0], top, c0[1], u0, vTop],
      [c1[0], top, c1[1], u1, vTop],
    );
  }
  pushFlatTri(bucket, ring[0], ring[1], ring[2], top, FACADE_TILE);
  pushFlatTri(bucket, ring[0], ring[2], ring[3], top, FACADE_TILE);
}

function defaultLoadTexture(url: string): THREE.Texture {
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

function loadSet(loadTexture: (url: string) => THREE.Texture, dir: string): TexSet {
  const color = loadTexture(`${dir}/color.jpg`);
  const normal = loadTexture(`${dir}/normal.jpg`);
  const roughness = loadTexture(`${dir}/roughness.jpg`);
  color.colorSpace = THREE.SRGBColorSpace;
  for (const t of [color, normal, roughness]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return { color, normal, roughness };
}

function facadeMaterial(set: TexSet, tint?: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.color,
    normalMap: set.normal,
    roughnessMap: set.roughness,
    roughness: 1,
    color: tint ?? 0xffffff,
  });
}

// Deterministic per-cell pick of the glass facade set.
function glassVariant(cx: number, cz: number): string {
  const h = (Math.imul(cx, 374761393) + Math.imul(cz, 668265263)) >>> 0;
  return ['glass-a', 'glass-b', 'glass-c'][(h ^ (h >>> 13)) % 3];
}

// Generated tiling wave normal map (no asset); integer frequencies keep the seams invisible.
function generateWaterNormalMap(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const k = (2 * Math.PI) / size;
  const wave = (x: number, y: number): number =>
    Math.sin(x * k * 3 + y * k * 2) * 0.5 +
    Math.sin(x * k * 1 - y * k * 4) * 0.4 +
    Math.sin((x + y) * k * 5) * 0.25;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = wave(i + 1, j) - wave(i - 1, j);
      const dy = wave(i, j + 1) - wave(i, j - 1);
      const invLen = 1 / Math.hypot(-dx, -dy, 2);
      const o = (j * size + i) * 4;
      data[o] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function minTerrain(terrainY: (x: number, z: number) => number, pts: readonly P2[]): number {
  let min = Infinity;
  for (const p of pts) {
    const y = terrainY(p[0], p[1]);
    if (y < min) min = y;
  }
  return Number.isFinite(min) ? min : 0;
}

export function createCityObject(
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
): CityObject {
  const group = new THREE.Group();
  group.name = 'city';
  const textures = new Set<THREE.Texture>();
  const glassSets: Record<string, TexSet> = {};
  for (const name of ['glass-a', 'glass-b', 'glass-c']) {
    glassSets[name] = loadSet(loadTexture, `textures/facade/${name}`);
  }
  const brickSet = loadSet(loadTexture, 'textures/facade/brick');
  const stoneSet = loadSet(loadTexture, 'textures/stone/old-wall');
  for (const set of [...Object.values(glassSets), brickSet, stoneSet]) {
    textures.add(set.color);
    textures.add(set.normal);
    textures.add(set.roughness);
  }
  const materials: Record<string, THREE.MeshStandardMaterial> = {
    'glass-a': facadeMaterial(glassSets['glass-a']),
    'glass-b': facadeMaterial(glassSets['glass-b']),
    'glass-c': facadeMaterial(glassSets['glass-c']),
    concrete: facadeMaterial(glassSets['glass-c'], CONCRETE_TINT),
    brick: facadeMaterial(brickSet),
    stone: facadeMaterial(stoneSet),
  };

  const buckets = new Map<string, GeoBucket>();
  const bucketOf = (key: string): GeoBucket => {
    const bucket = buckets.get(key);
    if (bucket) return bucket;
    const created: GeoBucket = { positions: [], uvs: [] };
    buckets.set(key, created);
    return created;
  };
  const cellKey = (mat: string, x: number, z: number): string =>
    `${mat}|${Math.floor(x / CITY_CELL)}|${Math.floor(z / CITY_CELL)}`;

  let buildings = 0;
  for (const b of env.buildings) {
    const pts = orientedRing(b.ring);
    if (distinctCount(pts) < 3) continue;
    let cx = 0;
    let cz = 0;
    for (const p of pts) {
      cx += p[0];
      cz += p[1];
    }
    const mat = b.material === 'glass'
      ? glassVariant(Math.floor(cx / pts.length / CITY_CELL), Math.floor(cz / pts.length / CITY_CELL))
      : b.material;
    const key = cellKey(mat, cx / pts.length, cz / pts.length);
    const geo = extrudeBuilding(pts, b.height, minTerrain(terrainY, pts));
    const src = geo.attributes.position.array;
    const uv = geo.attributes.uv?.array;
    const bucket = bucketOf(key);
    for (let i = 0; i < src.length; i++) bucket.positions.push(src[i]);
    if (uv) for (let i = 0; i < uv.length; i++) bucket.uvs.push(uv[i]);
    geo.dispose();
    buildings++;
  }

  for (const w of env.walls) {
    const pts = w.line.filter(
      (p, i) => i === 0 || p[0] !== w.line[i - 1][0] || p[1] !== w.line[i - 1][1],
    );
    if (pts.length < 2) continue;
    const baseY = minTerrain(terrainY, pts);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      emitWallStrip(
        bucketOf(cellKey('stone', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)),
        a,
        b,
        baseY,
        w.height,
        w.thickness / 2,
      );
    }
  }

  for (const [key, bucket] of buckets) {
    const geo = bucketGeometry(bucket);
    if (!geo) continue;
    const mat = key.split('|')[0];
    group.add(new THREE.Mesh(geo, materials[mat]));
  }

  const waterNormal = generateWaterNormalMap();
  textures.add(waterNormal);
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: WATER_COLOR,
    normalMap: waterNormal,
    transparent: true,
    opacity: 0.75,
    roughness: 0.25,
    metalness: 0,
  });
  const waterBucket: GeoBucket = { positions: [], uvs: [] };
  for (const poly of env.water) {
    const pts = orientedRing(poly);
    if (distinctCount(pts) < 3) continue;
    emitFlat(waterBucket, pts, minTerrain(terrainY, pts) - WATER_DROP, WATER_TILE);
  }
  const waterGeo = bucketGeometry(waterBucket);
  if (waterGeo) group.add(new THREE.Mesh(waterGeo, waterMaterial));

  let disposed = false;
  return {
    group,
    buildings,
    update(timeSeconds: number): void {
      waterNormal.offset.set(timeSeconds * WATER_SCROLL, timeSeconds * WATER_SCROLL);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const material of Object.values(materials)) material.dispose();
      waterMaterial.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

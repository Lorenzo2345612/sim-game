import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BarrierSegment, TrackDataV2 } from '../core/types';
import { barrierRuns, type BarrierVertex } from '../track/barrierPath';
import { createSurfaceMaterial, type SurfaceMaterialUserData } from './surfaceMaterials';

export interface BarrierObject {
  group: THREE.Group;
  dispose(): void;
}

const RAIL_BOTTOM = 0.45;
const RAIL_TOP = 0.75;
const POST_SPACING = 4;
const POST_SIZE = 0.1;
const POST_HEIGHT = 0.75;
const TYRE_RADIUS = 0.3;
const TYRE_HEIGHT = 0.25;
const TYRE_LAYERS = 3;
const TYRE_SPACING = 1;
const WALL_THICKNESS = 0.3;
const WALL_HEIGHT = 1;
// One metal tile every 2 m of rail; wall uv is metres / 10 like the strip surfaces.
const RAIL_TILE_METERS = 2;
const RAIL_UV_SCALE = 1 / RAIL_TILE_METERS;
const WALL_UV_SCALE = 1 / 10;
const TYRE_COLOR_A = new THREE.Color(0.9, 0.9, 0.9);
const TYRE_COLOR_B = new THREE.Color(0.75, 0.1, 0.1);

function defaultLoadTexture(url: string): THREE.Texture {
  // TextureLoader needs a DOM; fall back to a plain texture under Node.
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

interface PathPoint {
  x: number;
  y: number;
  z: number;
  s: number;
}

interface BarrierSpan {
  type: BarrierSegment['type'];
  verts: BarrierVertex[];
  closed: boolean;
}

function normalXZ(ax: number, az: number, bx: number, bz: number): [number, number] {
  let dx = bx - ax;
  let dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  dx /= len;
  dz /= len;
  return [-dz, dx];
}

function spanPath(verts: BarrierVertex[]): PathPoint[] {
  const path: PathPoint[] = [];
  let s = 0;
  for (let k = 0; k < verts.length; k++) {
    const v = verts[k];
    if (k > 0) {
      const p = path[k - 1];
      s += Math.hypot(v.x - p.x, v.z - p.z);
    }
    path.push({ x: v.x, y: v.y, z: v.z, s });
  }
  return path;
}

/**
 * Quads of a run grouped by type (the quad between two vertices takes the type
 * of the second one). Each span carries the polyline of its quads; a span is
 * closed only when it is the whole closed run.
 */
function runSpans(run: BarrierVertex[], closedRun: boolean): BarrierSpan[] {
  const m = run.length;
  const steps = closedRun ? m : m - 1;
  if (steps < 1) return [];
  const typeOf = (k: number): BarrierSegment['type'] => run[(k + 1) % m].type;
  const starts: number[] = [];
  for (let k = 0; k < steps; k++) {
    const prev = closedRun ? typeOf((k - 1 + steps) % steps) : k === 0 ? null : typeOf(k - 1);
    if (typeOf(k) !== prev) starts.push(k);
  }
  if (starts.length === 0) {
    return [{ type: typeOf(0), verts: run.slice(), closed: true }];
  }
  return starts.map((start) => {
    const type = typeOf(start);
    let len = 0;
    while (len < steps && typeOf((start + len) % steps) === type) len++;
    const verts: BarrierVertex[] = [];
    for (let j = 0; j <= len; j++) verts.push(run[(start + j) % m]);
    return { type, verts, closed: false };
  });
}

function pointAt(path: PathPoint[], s: number, out: THREE.Vector3): THREE.Vector3 {
  let i = 0;
  while (i < path.length - 1 && path[i + 1].s <= s) i++;
  const a = path[i];
  const b = i + 1 < path.length ? path[i + 1] : a;
  const span = b.s - a.s;
  const t = span > 1e-9 ? THREE.MathUtils.clamp((s - a.s) / span, 0, 1) : 0;
  return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

function appendRail(
  positions: number[],
  uvs: number[],
  indices: number[],
  path: PathPoint[],
  closed: boolean,
): void {
  const base = positions.length / 3;
  for (const p of path) {
    positions.push(p.x, p.y + RAIL_BOTTOM, p.z, p.x, p.y + RAIL_TOP, p.z);
    const u = p.s * RAIL_UV_SCALE;
    uvs.push(u, 0, u, 1);
  }
  const edge = (i: number, j: number): void => {
    indices.push(i, i + 1, j, i + 1, j + 1, j);
  };
  for (let k = 0; k + 1 < path.length; k++) edge(base + k * 2, base + (k + 1) * 2);
  if (closed && path.length > 1) edge(base + (path.length - 1) * 2, base);
}

// Wall cross-section is perpendicular to the barrier polyline itself.
function pathNormal(path: PathPoint[], i: number): [number, number] {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  return normalXZ(a.x, a.z, b.x, b.z);
}

// Section spans from the polyline outward so the inner face sits flush on the barrier line.
function appendWall(
  positions: number[],
  uvs: number[],
  indices: number[],
  path: PathPoint[],
  side: BarrierSegment['side'],
  closed: boolean,
): void {
  const tLo = side === 'right' ? 0 : -WALL_THICKNESS;
  const tHi = side === 'right' ? WALL_THICKNESS : 0;
  const base = positions.length / 3;
  const vTop = WALL_HEIGHT * WALL_UV_SCALE;
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const [nx, nz] = pathNormal(path, k);
    const lx = nx * tLo;
    const lz = nz * tLo;
    const hx = nx * tHi;
    const hz = nz * tHi;
    positions.push(
      p.x + lx, p.y, p.z + lz,
      p.x + hx, p.y, p.z + hz,
      p.x + lx, p.y + WALL_HEIGHT, p.z + lz,
      p.x + hx, p.y + WALL_HEIGHT, p.z + hz,
    );
    const u = p.s * WALL_UV_SCALE;
    uvs.push(u, 0, u, 0, u, vTop, u, vTop);
  }
  const edge = (i0: number, j0: number): void => {
    indices.push(i0 + 1, j0 + 1, j0 + 3, i0 + 1, j0 + 3, i0 + 3);
    indices.push(i0, i0 + 2, j0 + 2, i0, j0 + 2, j0);
    indices.push(i0 + 2, i0 + 3, j0 + 3, i0 + 2, j0 + 3, j0 + 2);
    indices.push(i0, j0, j0 + 1, i0, j0 + 1, i0 + 1);
  };
  for (let k = 0; k + 1 < path.length; k++) edge(base + k * 4, base + (k + 1) * 4);
  if (closed && path.length > 1) edge(base + (path.length - 1) * 4, base);
}

function tyreStackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < TYRE_LAYERS; i++) {
    const cylinder = new THREE.CylinderGeometry(TYRE_RADIUS, TYRE_RADIUS, TYRE_HEIGHT, 16);
    cylinder.translate(0, i * TYRE_HEIGHT + TYRE_HEIGHT / 2, 0);
    parts.push(cylinder);
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error('createBarrierObject: tyre geometry merge failed');
  return merged;
}

export function createBarrierObject(
  track: TrackDataV2,
  loadTexture?: (url: string) => THREE.Texture,
): BarrierObject {
  const load = loadTexture ?? defaultLoadTexture;
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const railPositions: number[] = [];
  const railUvs: number[] = [];
  const railIndices: number[] = [];
  const wallPositions: number[] = [];
  const wallUvs: number[] = [];
  const wallIndices: number[] = [];
  const posts: THREE.Vector3[] = [];
  const tyres: THREE.Vector3[] = [];
  let hasArmco = false;
  let hasTyres = false;
  let hasWall = false;

  const at = new THREE.Vector3();
  for (const side of ['right', 'left'] as const) {
    for (const run of barrierRuns(track, side)) {
      const closed = run.length === track.centerline.length;
      for (const span of runSpans(run, closed)) {
        const path = spanPath(span.verts);
        const length = path[path.length - 1].s;
        if (span.type === 'armco') {
          hasArmco = true;
          appendRail(railPositions, railUvs, railIndices, path, span.closed);
          const count = Math.floor(length / POST_SPACING) + 1;
          for (let k = 0; k < count; k++) {
            posts.push(pointAt(path, k * POST_SPACING, at).clone());
          }
        } else if (span.type === 'tyres') {
          hasTyres = true;
          const count = Math.floor(length / TYRE_SPACING) + 1;
          for (let k = 0; k < count; k++) {
            tyres.push(pointAt(path, k * TYRE_SPACING, at).clone());
          }
        } else {
          hasWall = true;
          appendWall(wallPositions, wallUvs, wallIndices, path, side, span.closed);
        }
      }
    }
  }

  if (hasArmco) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(railUvs, 2));
    geometry.setIndex(railIndices);
    geometry.computeVertexNormals();
    const map = load('textures/metal/color.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = load('textures/metal/normal.jpg');
    const roughnessMap = load('textures/metal/roughness.jpg');
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0b4b8,
      side: THREE.DoubleSide,
      map,
      normalMap,
      roughnessMap,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'armco';
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    textures.push(map, normalMap, roughnessMap);

    const postGeometry = new THREE.BoxGeometry(POST_SIZE, POST_HEIGHT, POST_SIZE);
    const posts_ = new THREE.InstancedMesh(postGeometry, material, posts.length);
    posts_.name = 'armcoPosts';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      matrix.makeTranslation(p.x, p.y + POST_HEIGHT / 2, p.z);
      posts_.setMatrixAt(i, matrix);
    }
    posts_.instanceMatrix.needsUpdate = true;
    posts_.castShadow = true;
    group.add(posts_);
    geometries.push(postGeometry);
  }

  if (hasTyres) {
    const geometry = tyreStackGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geometry, material, tyres.length);
    mesh.name = 'tyres';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < tyres.length; i++) {
      const p = tyres[i];
      matrix.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, i % 2 === 0 ? TYRE_COLOR_A : TYRE_COLOR_B);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }

  if (hasWall) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2));
    geometry.setIndex(wallIndices);
    geometry.computeVertexNormals();
    const material = createSurfaceMaterial('concrete', load);
    textures.push(...(material.userData as SurfaceMaterialUserData).textures);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wall';
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }

  let disposed = false;
  return {
    group,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

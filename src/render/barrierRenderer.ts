import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BarrierSegment, TrackDataV2 } from '../core/types';

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

interface PathPoint {
  x: number;
  y: number;
  z: number;
  s: number;
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

function barrierPath(track: TrackDataV2, seg: BarrierSegment): PathPoint[] {
  const centerline = track.centerline;
  const n = centerline.length;
  const sign = seg.side === 'right' ? 1 : -1;
  const count = ((seg.end - seg.start + n) % n) + 1;
  const path: PathPoint[] = [];
  let s = 0;
  for (let k = 0; k < count; k++) {
    const i = (seg.start + k) % n;
    const prev = centerline[(i - 1 + n) % n];
    const next = centerline[(i + 1) % n];
    const [nx, nz] = normalXZ(prev[0], prev[1], next[0], next[1]);
    const off = sign * seg.offsetMeters;
    const x = centerline[i][0] + nx * off;
    const z = centerline[i][1] + nz * off;
    const y = track.elevation[i] ?? 0;
    if (k > 0) {
      const p = path[k - 1];
      s += Math.hypot(x - p.x, z - p.z);
    }
    path.push({ x, y, z, s });
  }
  return path;
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

function appendRail(positions: number[], indices: number[], path: PathPoint[]): void {
  const base = positions.length / 3;
  for (const p of path) {
    positions.push(p.x, p.y + RAIL_BOTTOM, p.z, p.x, p.y + RAIL_TOP, p.z);
  }
  for (let k = 0; k + 1 < path.length; k++) {
    const i = base + k * 2;
    indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
}

// Wall cross-section is perpendicular to the barrier polyline itself.
function pathNormal(path: PathPoint[], i: number): [number, number] {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  return normalXZ(a.x, a.z, b.x, b.z);
}

// Section spans from the polyline outward so the inner face sits flush on the barrier line.
function appendWall(positions: number[], indices: number[], path: PathPoint[], side: BarrierSegment['side']): void {
  const tLo = side === 'right' ? 0 : -WALL_THICKNESS;
  const tHi = side === 'right' ? WALL_THICKNESS : 0;
  const base = positions.length / 3;
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
  }
  for (let k = 0; k + 1 < path.length; k++) {
    const i0 = base + k * 4;
    const j0 = i0 + 4;
    indices.push(i0 + 1, j0 + 1, j0 + 3, i0 + 1, j0 + 3, i0 + 3);
    indices.push(i0, i0 + 2, j0 + 2, i0, j0 + 2, j0);
    indices.push(i0 + 2, i0 + 3, j0 + 3, i0 + 2, j0 + 3, j0 + 2);
    indices.push(i0, j0, j0 + 1, i0, j0 + 1, i0 + 1);
  }
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

export function createBarrierObject(track: TrackDataV2): BarrierObject {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const railPositions: number[] = [];
  const railIndices: number[] = [];
  const wallPositions: number[] = [];
  const wallIndices: number[] = [];
  const posts: THREE.Vector3[] = [];
  const tyres: THREE.Vector3[] = [];
  let hasArmco = false;
  let hasTyres = false;
  let hasWall = false;

  const at = new THREE.Vector3();
  for (const seg of track.barriers) {
    const path = barrierPath(track, seg);
    const length = path[path.length - 1].s;
    if (seg.type === 'armco') {
      hasArmco = true;
      appendRail(railPositions, railIndices, path);
      const count = Math.floor(length / POST_SPACING) + 1;
      for (let k = 0; k < count; k++) {
        posts.push(pointAt(path, k * POST_SPACING, at).clone());
      }
    } else if (seg.type === 'tyres') {
      hasTyres = true;
      const count = Math.floor(length / TYRE_SPACING) + 1;
      for (let k = 0; k < count; k++) {
        tyres.push(pointAt(path, k * TYRE_SPACING, at).clone());
      }
    } else {
      hasWall = true;
      appendWall(wallPositions, wallIndices, path, seg.side);
    }
  }

  if (hasArmco) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
    geometry.setIndex(railIndices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xb0b4b8, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'armco';
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);

    const postGeometry = new THREE.BoxGeometry(POST_SIZE, POST_HEIGHT, POST_SIZE);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa0a6 });
    const posts_ = new THREE.InstancedMesh(postGeometry, postMaterial, posts.length);
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
    materials.push(postMaterial);
  }

  if (hasTyres) {
    const geometry = tyreStackGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const mesh = new THREE.InstancedMesh(geometry, material, tyres.length);
    mesh.name = 'tyres';
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < tyres.length; i++) {
      const p = tyres[i];
      matrix.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, matrix);
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
    geometry.setIndex(wallIndices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0xc8c8c2 });
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
    },
  };
}

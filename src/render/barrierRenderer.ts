import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../core/types';
import { barrierRuns, type BarrierVertex } from '../track/barrierPath';
import {
  ARMCO_POST_SPACING,
  FENCE_HEIGHT,
  FENCE_OFFSET,
  TYRE_OUTER_RADIUS,
  TYRE_PITCH,
  TYRE_ROW_HEIGHT,
  TYRE_ROWS,
  wBeamProfile,
} from './barrierProfiles';
import { createSurfaceMaterial, type SurfaceMaterialUserData } from './surfaceMaterials';

export interface BarrierObject {
  group: THREE.Group;
  dispose(): void;
}

// One metal tile every 2 m of rail; fence tile every 3 m; wall uv is metres / 10.
const RAIL_UV_SCALE = 1 / 2;
const FENCE_UV_SCALE = 1 / 3;
const WALL_UV_SCALE = 1 / 10;
const WALL_THICKNESS = 0.3;
const WALL_HEIGHT = 1;
const POST_WIDTH = 0.08;
const POST_HEIGHT = 0.75;
const POST_DEPTH = 0.12;
const POST_BEHIND = 0.1;
const TYRE_COLOR_A = new THREE.Color(0.9, 0.9, 0.9);
const TYRE_COLOR_B = new THREE.Color(0.75, 0.1, 0.1);

function defaultLoadTexture(url: string): THREE.Texture {
  // TextureLoader needs a DOM; fall back to a plain texture under Node.
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

function repeatWrapping(texture: THREE.Texture): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
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
    // Only a closed run wraps: an open run must not join across its ends.
    while (len < steps && (closedRun || start + len < steps) && typeOf((start + len) % steps) === type) len++;
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

// Wall cross-section is perpendicular to the barrier polyline itself.
function pathNormal(path: PathPoint[], i: number): [number, number] {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  return normalXZ(a.x, a.z, b.x, b.z);
}

// Path segment index containing arc position s.
function pathIndexAt(path: PathPoint[], s: number): number {
  let i = 0;
  while (i < path.length - 1 && path[i + 1].s <= s) i++;
  return i;
}

// Centerline normal at a vertex index: the direction barrierRuns offsets by,
// and the true "away from track" direction for instances placed on the line.
function centerlineNormal(track: TrackDataV2, i: number): [number, number] {
  const cx = track.centerline;
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  return normalXZ(prev[0], prev[1], next[0], next[1]);
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

function profileVFractions(profile: Array<[number, number]>): number[] {
  const fractions = [0];
  let total = 0;
  for (let m = 1; m < profile.length; m++) {
    total += Math.hypot(profile[m][0] - profile[m - 1][0], profile[m][1] - profile[m - 1][1]);
    fractions.push(total);
  }
  if (total > 0) {
    for (let m = 0; m < fractions.length; m++) fractions[m] /= total;
  }
  return fractions;
}

// W-beam section extruded along the span path; sign +1 = right side, -1 = left.
function appendRail(
  positions: number[],
  uvs: number[],
  indices: number[],
  path: PathPoint[],
  sign: number,
  closed: boolean,
): void {
  const profile = wBeamProfile();
  const vAt = profileVFractions(profile);
  const width = profile.length;
  const base = positions.length / 3;
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const [nx, nz] = pathNormal(path, k);
    const ox = nx * sign;
    const oz = nz * sign;
    for (let m = 0; m < width; m++) {
      const [t, y] = profile[m];
      positions.push(p.x + ox * t, p.y + y, p.z + oz * t);
      uvs.push(p.s * RAIL_UV_SCALE, vAt[m]);
    }
  }
  const edge = (i: number, j: number): void => {
    for (let m = 0; m + 1 < width; m++) {
      indices.push(i + m, j + m, j + m + 1, i + m, j + m + 1, i + m + 1);
    }
  };
  for (let k = 0; k + 1 < path.length; k++) edge(base + k * width, base + (k + 1) * width);
  if (closed && path.length > 1) edge(base + (path.length - 1) * width, base);
}

// Catch fence: one 3 m vertical quad per path edge, 1 m behind the rail line.
function appendFence(
  positions: number[],
  uvs: number[],
  indices: number[],
  path: PathPoint[],
  sign: number,
  closed: boolean,
): void {
  const base = positions.length / 3;
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const [nx, nz] = pathNormal(path, k);
    const x = p.x + nx * sign * FENCE_OFFSET;
    const z = p.z + nz * sign * FENCE_OFFSET;
    positions.push(x, p.y, z, x, p.y + FENCE_HEIGHT, z);
    const u = p.s * FENCE_UV_SCALE;
    uvs.push(u, 0, u, FENCE_HEIGHT * FENCE_UV_SCALE);
  }
  const edge = (i: number, j: number): void => {
    indices.push(i, i + 1, j, i + 1, j + 1, j);
  };
  for (let k = 0; k + 1 < path.length; k++) edge(base + k * 2, base + (k + 1) * 2);
  if (closed && path.length > 1) edge(base + (path.length - 1) * 2, base);
}

// Flat torus: outer radius 0.31, height 0.25, 144 triangles.
function tyreGeometry(): THREE.BufferGeometry {
  const tube = TYRE_ROW_HEIGHT / 2;
  const geometry = new THREE.TorusGeometry(TYRE_OUTER_RADIUS - tube, tube, 12, 6);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

interface InstanceSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
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
  const fencePositions: number[] = [];
  const fenceUvs: number[] = [];
  const fenceIndices: number[] = [];
  const wallPositions: number[] = [];
  const wallUvs: number[] = [];
  const wallIndices: number[] = [];
  const posts: InstanceSpot[] = [];
  const tyres: InstanceSpot[] = [];
  let hasArmco = false;
  let hasTyres = false;
  let hasWall = false;

  const at = new THREE.Vector3();
  for (const side of ['right', 'left'] as const) {
    const sign = side === 'right' ? 1 : -1;
    for (const run of barrierRuns(track, side)) {
      const closed = run.length === track.centerline.length;
      for (const span of runSpans(run, closed)) {
        const path = spanPath(span.verts);
        const length = path[path.length - 1].s;
        if (length <= 1e-9) continue;
        if (span.type === 'armco') {
          hasArmco = true;
          appendRail(railPositions, railUvs, railIndices, path, sign, span.closed);
          appendFence(fencePositions, fenceUvs, fenceIndices, path, sign, span.closed);
          const count = Math.floor(length / ARMCO_POST_SPACING) + 1;
          for (let k = 0; k < count; k++) {
            const s = k * ARMCO_POST_SPACING;
            pointAt(path, s, at);
            const i = pathIndexAt(path, s);
            const [nx, nz] = centerlineNormal(track, span.verts[i].index);
            const ox = nx * sign;
            const oz = nz * sign;
            posts.push({
              x: at.x + ox * POST_BEHIND,
              y: at.y,
              z: at.z + oz * POST_BEHIND,
              yaw: Math.atan2(ox, oz),
            });
          }
        } else if (span.type === 'tyres') {
          hasTyres = true;
          // Odd rows start staggered half a pitch and end one radius short.
          for (let r = 0; r < TYRE_ROWS; r++) {
            const start = (r % 2) * TYRE_OUTER_RADIUS;
            for (let k = 0; ; k++) {
              const s = start + k * TYRE_PITCH;
              if (s + start > length + 1e-9) break;
              pointAt(path, s, at);
              const i = pathIndexAt(path, s);
              const [nx, nz] = centerlineNormal(track, span.verts[i].index);
              tyres.push({
                x: at.x + nx * sign * TYRE_OUTER_RADIUS,
                y: at.y + r * TYRE_ROW_HEIGHT + TYRE_ROW_HEIGHT / 2,
                z: at.z + nz * sign * TYRE_OUTER_RADIUS,
                yaw: 0,
              });
            }
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
    const material = new THREE.MeshStandardMaterial({
      color: 0xb0b4b8,
      side: THREE.DoubleSide,
      map: repeatWrapping(map),
      normalMap: repeatWrapping(normalMap),
      roughnessMap: repeatWrapping(roughnessMap),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'armco';
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    textures.push(map, normalMap, roughnessMap);

    if (posts.length > 0) {
      const postGeometry = new THREE.BoxGeometry(POST_WIDTH, POST_HEIGHT, POST_DEPTH);
      const postsMesh = new THREE.InstancedMesh(postGeometry, material, posts.length);
      postsMesh.name = 'armcoPosts';
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < posts.length; i++) {
        const p = posts[i];
        matrix.makeRotationY(p.yaw);
        matrix.setPosition(p.x, p.y + POST_HEIGHT / 2, p.z);
        postsMesh.setMatrixAt(i, matrix);
      }
      postsMesh.instanceMatrix.needsUpdate = true;
      postsMesh.castShadow = true;
      group.add(postsMesh);
      geometries.push(postGeometry);
    }

    const fenceGeometry = new THREE.BufferGeometry();
    fenceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fencePositions, 3));
    fenceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(fenceUvs, 2));
    fenceGeometry.setIndex(fenceIndices);
    fenceGeometry.computeVertexNormals();
    const fenceMap = load('textures/fence/color.jpg');
    fenceMap.colorSpace = THREE.SRGBColorSpace;
    const fenceAlphaMap = load('textures/fence/opacity.jpg');
    const fenceMaterial = new THREE.MeshStandardMaterial({
      map: repeatWrapping(fenceMap),
      alphaMap: repeatWrapping(fenceAlphaMap),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    const fence = new THREE.Mesh(fenceGeometry, fenceMaterial);
    fence.name = 'fence';
    group.add(fence);
    geometries.push(fenceGeometry);
    materials.push(fenceMaterial);
    textures.push(fenceMap, fenceAlphaMap);
  }

  if (hasTyres) {
    const geometry = tyreGeometry();
    const map = load('textures/rubber/color.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = load('textures/rubber/normal.jpg');
    const roughnessMap = load('textures/rubber/roughness.jpg');
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      map: repeatWrapping(map),
      normalMap: repeatWrapping(normalMap),
      roughnessMap: repeatWrapping(roughnessMap),
    });
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
    textures.push(map, normalMap, roughnessMap);
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

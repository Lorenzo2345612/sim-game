import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../core/types';
import { DEFAULT_TRACK_STYLE, segmentOverride, type ResolvedTrackStyle } from '../track/trackStyle';
import { barrierRuns, type BarrierVertex } from '../track/barrierPath';
import {
  ARMCO_POST_SPACING,
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
  foamBlocks: number;
  dispose(): void;
}

export const FOAM_PITCH = 1.0;
export const FOAM_HEIGHT = 1.0;
export const FOAM_DEPTH = 0.6;
export const FOAM_WIDTH = 0.96;

// One metal tile every 2 m of rail; fence tile every 3 m; wall uv is metres / 10.
const RAIL_UV_SCALE = 1 / 2;
const FENCE_UV_SCALE = 1 / 3;
const WALL_UV_SCALE = 1 / 10;
const WALL_THICKNESS = 0.3;
const WALL_HEIGHT = 1;
const WALL_BAND_LOW = 0.35;
const WALL_BAND_HEIGHT = 0.3;
const WALL_BAND_PUSH = 0.01;
const POST_WIDTH = 0.08;
const POST_HEIGHT = 0.75;
const POST_DEPTH = 0.12;
const POST_BEHIND = 0.1;
const TYRE_COLOR_A = new THREE.Color(0.9, 0.9, 0.9);
const TYRE_COLOR_B = new THREE.Color(0.75, 0.1, 0.1);
const FOAM_COLORS = [0x1f4fbf, 0xcc2222, 0xf0f0f0];
const FOAM_NAMES = ['foamBlue', 'foamRed', 'foamWhite'];

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

// Painted strip on the wall face that looks at the track, pushed clear of it.
function appendWallBand(
  positions: number[],
  indices: number[],
  path: PathPoint[],
  side: BarrierSegment['side'],
  closed: boolean,
): void {
  const t = side === 'right' ? -WALL_BAND_PUSH : WALL_BAND_PUSH;
  const base = positions.length / 3;
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    const [nx, nz] = pathNormal(path, k);
    const x = p.x + nx * t;
    const z = p.z + nz * t;
    positions.push(x, p.y + WALL_BAND_LOW, z, x, p.y + WALL_BAND_LOW + WALL_BAND_HEIGHT, z);
  }
  const edge = (i0: number, j0: number): void => {
    indices.push(i0, i0 + 1, j0, i0 + 1, j0 + 1, j0);
  };
  for (let k = 0; k + 1 < path.length; k++) edge(base + k * 2, base + (k + 1) * 2);
  if (closed && path.length > 1) edge(base + (path.length - 1) * 2, base);
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

// Catch fence: one quad per path edge at the height of the edge's second
// vertex, 1 m behind the rail line; returns the horizontal length added.
function appendFence(
  positions: number[],
  uvs: number[],
  indices: number[],
  path: PathPoint[],
  heights: number[],
  sign: number,
  closed: boolean,
): number {
  const quad = (a: PathPoint, b: PathPoint, ia: number, ib: number, h: number): void => {
    const base = positions.length / 3;
    const [anx, anz] = pathNormal(path, ia);
    const [bnx, bnz] = pathNormal(path, ib);
    const ax = a.x + anx * sign * FENCE_OFFSET;
    const az = a.z + anz * sign * FENCE_OFFSET;
    const bx = b.x + bnx * sign * FENCE_OFFSET;
    const bz = b.z + bnz * sign * FENCE_OFFSET;
    positions.push(ax, a.y, az, ax, a.y + h, az, bx, b.y, bz, bx, b.y + h, bz);
    const ua = a.s * FENCE_UV_SCALE;
    const ub = b.s * FENCE_UV_SCALE;
    const vTop = h * FENCE_UV_SCALE;
    uvs.push(ua, 0, ua, vTop, ub, 0, ub, vTop);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  let meters = 0;
  for (let k = 1; k < path.length; k++) {
    const h = heights[k];
    if (h <= 0) continue;
    quad(path[k - 1], path[k], k - 1, k, h);
    meters += path[k].s - path[k - 1].s;
  }
  const last = path.length - 1;
  if (closed && last > 0 && heights[0] > 0) {
    quad(path[last], path[0], last, 0, heights[0]);
    meters += Math.hypot(path[0].x - path[last].x, path[0].z - path[last].z);
  }
  return meters;
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
  style?: ResolvedTrackStyle,
): BarrierObject {
  const st = style ?? DEFAULT_TRACK_STYLE;
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
  const bandPositions: number[] = [];
  const bandIndices: number[] = [];
  const posts: InstanceSpot[] = [];
  const tyres: InstanceSpot[] = [];
  const bandColor = st.barriers.concrete.bandColor;
  const beltColor = st.barriers.tyres.beltColor;
  const tyreColorB = beltColor ? new THREE.Color(beltColor) : TYRE_COLOR_B;
  const foamColors = st.barriers.foam.colors;
  const foamPalette: THREE.Color[] = foamColors
    ? foamColors.map((c) => new THREE.Color(c))
    : FOAM_COLORS.map((c) => new THREE.Color(c));
  const foamNames = foamColors ? ['foamA', 'foamB'] : FOAM_NAMES;
  const foamSpots: InstanceSpot[][] = Array.from({ length: foamNames.length }, () => []);
  const pointCount = track.centerline.length;
  // A matching range wins over the global fence settings for that vertex.
  const fenceHeightOf = (v: BarrierVertex, side: BarrierSegment['side']): number => {
    const over = segmentOverride(st.barriers.ranges, { start: v.index, end: v.index, side }, pointCount);
    if (over) return over.fenceHeightMeters;
    return st.barriers.fence.types.includes(v.type) ? st.barriers.fence.heightMeters : 0;
  };
  let fenceMeters = 0;
  let foamTotal = 0;
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
        const heights = span.verts.map((v) => fenceHeightOf(v, side));
        fenceMeters += appendFence(fencePositions, fenceUvs, fenceIndices, path, heights, sign, span.closed);
        if (span.type === 'armco') {
          hasArmco = true;
          appendRail(railPositions, railUvs, railIndices, path, sign, span.closed);
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
        } else if (span.type === 'foam') {
          // Colour runs over the whole object, so blocks of one span carry into the next.
          const count = Math.floor(length / FOAM_PITCH);
          for (let k = 0; k < count; k++) {
            const s = (k + 0.5) * FOAM_PITCH;
            pointAt(path, s, at);
            const i = pathIndexAt(path, s);
            const [nx, nz] = centerlineNormal(track, span.verts[i].index);
            const ox = nx * sign;
            const oz = nz * sign;
            foamSpots[foamTotal % foamSpots.length].push({
              x: at.x + ox * (FOAM_DEPTH / 2),
              y: at.y,
              z: at.z + oz * (FOAM_DEPTH / 2),
              yaw: Math.atan2(ox, oz),
            });
            foamTotal++;
          }
        } else {
          hasWall = true;
          appendWall(wallPositions, wallUvs, wallIndices, path, side, span.closed);
          if (bandColor) appendWallBand(bandPositions, bandIndices, path, side, span.closed);
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
      color: st.barriers.armco.color ?? 0xb0b4b8,
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
  }

  if (fenceIndices.length > 0) {
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
    const fenceColor = st.barriers.fence.color;
    if (fenceColor) fenceMaterial.color.set(fenceColor);
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
      mesh.setColorAt(i, i % 2 === 0 ? TYRE_COLOR_A : tyreColorB);
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
    const concreteColor = st.barriers.concrete.color;
    if (concreteColor) material.color.set(concreteColor);
    textures.push(...(material.userData as SurfaceMaterialUserData).textures);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wall';
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }

  if (bandColor && bandPositions.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bandPositions, 3));
    geometry.setIndex(bandIndices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: bandColor, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'wallBand';
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  }

  if (foamTotal > 0) {
    const geometry = new THREE.BoxGeometry(FOAM_WIDTH, FOAM_HEIGHT, FOAM_DEPTH);
    geometries.push(geometry);
    const matrix = new THREE.Matrix4();
    for (let c = 0; c < foamNames.length; c++) {
      const spots = foamSpots[c];
      if (spots.length === 0) continue;
      const material = new THREE.MeshStandardMaterial({
        color: foamPalette[c],
        roughness: 0.6,
        metalness: 0,
      });
      materials.push(material);
      const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
      mesh.name = foamNames[c];
      for (let i = 0; i < spots.length; i++) {
        const p = spots[i];
        // Base on the path: the box centre sits half a height above it.
        matrix.makeRotationY(p.yaw);
        matrix.setPosition(p.x, p.y + FOAM_HEIGHT / 2, p.z);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  group.userData.fenceMeters = fenceMeters;
  let disposed = false;
  return {
    group,
    foamBlocks: foamTotal,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

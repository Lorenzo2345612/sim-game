import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Side, TrackDataV2 } from '../core/types';
import { barrierRuns } from '../track/barrierPath';
import { LIVERY_PALETTE } from '../game/livery';

export interface StreetFurniture {
  group: THREE.Group;
  lamps: number;
  sidewalks: number;
  billboards: number;
  dispose(): void;
}

const LAMP_SPACING = 40;
const LAMP_INSET = 1;
// The lamp model is 0.6 m tall at scale 1; 10x gives a 6 m street lamp.
const LAMP_SCALE = 10;
const SIDEWALK_WIDTH = 3;
const UV_PER_METRE = 1 / 4;
const BILLBOARD_PITCH = 400;
const BILLBOARD_SPAN = 100; // m either side of a candidate that must stay straight
const STRAIGHT_RADIUS = 500;
// Radius is measured over this baseline: at the 2 m centerline spacing, the
// millimetre-scale resampling wiggles would read as sub-500 m corners.
const STRAIGHT_BASELINE = 10;
const PANEL_WIDTH = 12;
const PANEL_HEIGHT = 4;
const PANEL_Y = 3.5; // panel centre above the wall foot
const POST_SIZE = 0.2;
const POST_HEIGHT = 4;
const POST_X = 5.5;
const POST_Z = -0.15; // behind the panel, away from the track
const BILLBOARD_OFFSET = SIDEWALK_WIDTH + 1; // sidewalk plus a gap behind the wall
const LAMP_POLE_HEIGHT = 6;

interface PathPoint {
  x: number;
  y: number;
  z: number;
}

interface Spot extends PathPoint {
  yaw: number;
}

interface Frame {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

interface WallRun {
  pts: PathPoint[];
  closed: boolean;
}

function defaultLoadTexture(url: string): THREE.Texture {
  // TextureLoader needs a DOM; fall back to a plain texture under Node.
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

function materialOf(mesh: THREE.Mesh): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

function cumulative(pts: PathPoint[]): number[] {
  const out = new Array<number>(pts.length);
  out[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    out[i] = out[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  }
  return out;
}

/** Arc positions 0, spacing, ... <= length (endpoint at exactly length included). */
function sampleArc(length: number, spacing: number): number[] {
  if (!(spacing > 0) || !(length >= 0)) return [];
  const n = Math.floor(length / spacing + 1e-9) + 1;
  const out = new Array<number>(n);
  for (let k = 0; k < n; k++) out[k] = k * spacing;
  return out;
}

function frameAt(pts: PathPoint[], cum: number[], s: number): Frame {
  const last = pts.length - 1;
  let i = 0;
  while (i < last - 1 && cum[i + 1] <= s) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const span = cum[i + 1] - cum[i];
  const t = span > 1e-9 ? Math.min(Math.max((s - cum[i]) / span, 0), 1) : 0;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  // Right-hand normal of the segment; the path must run with the track to face outward.
  const nx = len > 1e-9 ? -dz / len : 0;
  const nz = len > 1e-9 ? dx / len : -1;
  return { x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t, nx, nz };
}

function lampSpots(pts: PathPoint[], spacing: number, inset: number): Spot[] {
  if (pts.length < 2) return [];
  const cum = cumulative(pts);
  const out: Spot[] = [];
  for (const s of sampleArc(cum[cum.length - 1], spacing)) {
    const f = frameAt(pts, cum, s);
    out.push({
      x: f.x + f.nx * inset,
      y: f.y,
      z: f.z + f.nz * inset,
      yaw: Math.atan2(f.nx, f.nz),
    });
  }
  return out;
}

/**
 * Lamp positions along a wall path at `spacing` metre intervals, shifted `inset`
 * metres along the path's right-hand normal (so the path must run with the track
 * and the outward side on its right). Yaw faces the track.
 */
export function lampPositions(
  wallPath: [number, number][],
  spacing: number,
  inset: number,
): { x: number; z: number; yaw: number }[] {
  if (wallPath.length < 2) return [];
  const pts: PathPoint[] = wallPath.map(([x, z]) => ({ x, y: 0, z }));
  return lampSpots(pts, spacing, inset).map(({ x, z, yaw }) => ({ x, z, yaw }));
}

function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

function vertexNormal(pts: PathPoint[], i: number): [number, number] {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

/**
 * Barrier runs oriented so the right-hand normal points away from the track
 * (left runs are reversed), each closed run closed geometrically, plus the wall
 * vertex of every covered centerline index per side.
 */
function wallLayout(
  track: TrackDataV2,
): { runs: WallRun[]; byIndex: Map<Side, Map<number, PathPoint>> } {
  const runs: WallRun[] = [];
  const byIndex = new Map<Side, Map<number, PathPoint>>([
    ['left', new Map()],
    ['right', new Map()],
  ]);
  for (const side of ['right', 'left'] as const) {
    const index = byIndex.get(side) as Map<number, PathPoint>;
    for (const run of barrierRuns(track, side)) {
      if (run.length < 2) continue;
      const closed = run.length === track.centerline.length;
      const pts: PathPoint[] = run.map((v) => {
        index.set(v.index, { x: v.x, y: v.y, z: v.z });
        return { x: v.x, y: v.y, z: v.z };
      });
      if (side === 'left') pts.reverse();
      if (closed) pts.push({ ...pts[0] });
      runs.push({ pts, closed });
    }
  }
  return { runs, byIndex };
}

// One quad per path edge, 3 m outward, flat at the wall's height, uv in metres / 4.
function appendSidewalk(
  positions: number[],
  uvs: number[],
  normals: number[],
  indices: number[],
  pts: PathPoint[],
): void {
  const base = positions.length / 3;
  const cum = cumulative(pts);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const [nx, nz] = vertexNormal(pts, i);
    const u = cum[i] * UV_PER_METRE;
    positions.push(p.x, p.y, p.z, p.x + nx * SIDEWALK_WIDTH, p.y, p.z + nz * SIDEWALK_WIDTH);
    uvs.push(u, 0, u, SIDEWALK_WIDTH * UV_PER_METRE);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = base + i * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
}

function circumradius(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number | null {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (ab < 1e-9 || bc < 1e-9 || ca < 1e-9 || Math.abs(cross) < 1e-9) return null;
  return (ab * bc * ca) / (2 * Math.abs(cross));
}

/** Point of the closed centerline polyline at arc length s (wrapped into [0, length)). */
function pointAtArc(
  cx: [number, number][],
  cum: number[],
  length: number,
  s: number,
): [number, number] {
  const t = ((s % length) + length) % length;
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] <= t) i++;
  const j = (i + 1) % cx.length;
  const span = i + 1 === cx.length ? length - cum[i] : cum[i + 1] - cum[i];
  const f = span > 1e-9 ? Math.min(Math.max((t - cum[i]) / span, 0), 1) : 0;
  return [cx[i][0] + (cx[j][0] - cx[i][0]) * f, cx[i][1] + (cx[j][1] - cx[i][1]) * f];
}

function straightOver(cx: [number, number][], cum: number[], length: number, s: number): boolean {
  const n = cx.length;
  for (let i = 0; i < n; i++) {
    const d = cum[i] - s;
    const wrapped = ((d % length) + length) % length;
    if (wrapped > BILLBOARD_SPAN && wrapped < length - BILLBOARD_SPAN) continue;
    const radius = circumradius(
      pointAtArc(cx, cum, length, cum[i] - STRAIGHT_BASELINE),
      cx[i],
      pointAtArc(cx, cum, length, cum[i] + STRAIGHT_BASELINE),
    );
    if (radius !== null && radius <= STRAIGHT_RADIUS) return false;
  }
  return true;
}

function indexAt(cum: number[], s: number): number {
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] <= s) i++;
  return i;
}

interface LampSource {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

let lampSource: LampSource | null = null;

/**
 * Loads the street lamp GLB once per session. `createStreetFurniture` falls back
 * to a procedural post when this was not called or the model fails to load.
 */
export async function loadLampModel(url = '/models/props/lamp.glb'): Promise<boolean> {
  if (lampSource) return true;
  try {
    const manager = new THREE.LoadingManager();
    // lamp.glb references Textures/colormap.png inside its own folder; the file lives in /models/Textures.
    manager.setURLModifier((target) =>
      target.endsWith('props/Textures/colormap.png') ? 'models/Textures/colormap.png' : target,
    );
    const gltf = await new GLTFLoader(manager).loadAsync(url);
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) meshes.push(mesh);
    });
    if (meshes.length === 0) return false;
    lampSource = { geometry: meshes[0].geometry, material: materialOf(meshes[0]) };
    const kept = new Set<unknown>([lampSource.geometry, lampSource.material]);
    for (const value of Object.values(lampSource.material)) {
      if ((value as THREE.Texture | null)?.isTexture) kept.add(value);
    }
    for (const mesh of meshes) {
      if (!kept.has(mesh.geometry)) mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (kept.has(material)) continue;
        for (const value of Object.values(material)) {
          const texture = value as THREE.Texture | null;
          if (texture?.isTexture && !kept.has(texture)) texture.dispose();
        }
        material.dispose();
      }
    }
    return true;
  } catch {
    return false;
  }
}

function fallbackLampGeometry(): THREE.BufferGeometry {
  const pole = new THREE.BoxGeometry(0.14, LAMP_POLE_HEIGHT, 0.14);
  pole.translate(0, LAMP_POLE_HEIGHT / 2, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 1.8);
  arm.translate(0, LAMP_POLE_HEIGHT - 0.1, -0.9);
  const head = new THREE.BoxGeometry(0.5, 0.18, 0.6);
  head.translate(0, LAMP_POLE_HEIGHT - 0.2, -1.7);
  const merged = mergeGeometries([pole, arm, head]);
  pole.dispose();
  arm.dispose();
  head.dispose();
  return merged ?? new THREE.BoxGeometry(0.14, LAMP_POLE_HEIGHT, 0.14);
}

export function createStreetFurniture(
  track: TrackDataV2,
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
): StreetFurniture {
  const group = new THREE.Group();
  group.name = 'streetFurniture';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  let lamps = 0;
  let sidewalks = 0;
  let billboards = 0;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };

  if (track.environment !== 'city') return { group, lamps, sidewalks, billboards, dispose };

  const { runs, byIndex } = wallLayout(track);

  if (runs.length > 0) {
    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (const run of runs) {
      appendSidewalk(positions, uvs, normals, indices, run.pts);
      sidewalks++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    const map = loadTexture('textures/pavement/color.jpg');
    const normalMap = loadTexture('textures/pavement/normal.jpg');
    const roughnessMap = loadTexture('textures/pavement/roughness.jpg');
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
    }
    const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'sidewalks';
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    textures.push(map, normalMap, roughnessMap);
  }

  const spots: Spot[] = [];
  for (const run of runs) {
    const list = lampSpots(run.pts, LAMP_SPACING, LAMP_INSET);
    // A closed run samples its own start again when the length is a whole multiple.
    if (run.closed && list.length > 1) {
      const first = list[0];
      const last = list[list.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) list.pop();
    }
    spots.push(...list);
  }
  if (spots.length > 0) {
    const geometry = lampSource ? lampSource.geometry.clone() : fallbackLampGeometry();
    const material = lampSource ? lampSource.material.clone() : new THREE.MeshStandardMaterial({
      color: 0x3a3f44,
      roughness: 0.7,
      metalness: 0.3,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    mesh.name = 'lamps';
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE);
    for (let i = 0; i < spots.length; i++) {
      const spot = spots[i];
      matrix.makeRotationY(spot.yaw);
      matrix.scale(scale);
      matrix.setPosition(spot.x, spot.y, spot.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    lamps = spots.length;
  }

  const cx = track.centerline;
  const n = cx.length;
  if (n >= 3) {
    const cum = new Array<number>(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      cum[i] = total;
      const j = (i + 1) % n;
      total += Math.hypot(cx[j][0] - cx[i][0], cx[j][1] - cx[i][1]);
    }
    const origins = new Map<number, THREE.Matrix4[]>();
    const origin = new THREE.Matrix4();
    for (const s of sampleArc(total, BILLBOARD_PITCH)) {
      if (s >= total - 1e-9) break; // the closed loop ends where it starts
      if (!straightOver(cx, cum, total, s)) continue;
      const i = indexAt(cum, s);
      for (const side of ['right', 'left'] as const) {
        const wall = byIndex.get(side)?.get(i);
        if (!wall) continue;
        const [rx, rz] = rightNormalAt(cx, i);
        const sign = side === 'right' ? 1 : -1;
        const ox = rx * sign;
        const oz = rz * sign;
        origin.makeRotationY(Math.atan2(-ox, -oz));
        origin.setPosition(wall.x + ox * BILLBOARD_OFFSET, wall.y, wall.z + oz * BILLBOARD_OFFSET);
        const colour = billboards % LIVERY_PALETTE.length;
        const list = origins.get(colour);
        if (list) list.push(origin.clone());
        else origins.set(colour, [origin.clone()]);
        billboards++;
      }
    }
    if (billboards > 0) {
      const panelGeometry = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
      const postGeometry = new THREE.BoxGeometry(POST_SIZE, POST_HEIGHT, POST_SIZE);
      geometries.push(panelGeometry, postGeometry);
      const panelLocal = new THREE.Matrix4().makeTranslation(0, PANEL_Y, 0);
      const postLocal = new THREE.Matrix4().makeTranslation(POST_X, POST_HEIGHT / 2, POST_Z);
      const postLocalOther = new THREE.Matrix4().makeTranslation(-POST_X, POST_HEIGHT / 2, POST_Z);
      const postMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a3f44,
        roughness: 0.7,
        metalness: 0.3,
      });
      materials.push(postMaterial);
      const postMatrices: THREE.Matrix4[] = [];
      for (const list of origins.values()) {
        for (const base of list) {
          postMatrices.push(base.clone().multiply(postLocal), base.clone().multiply(postLocalOther));
        }
      }
      const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postMatrices.length);
      posts.name = 'billboardPosts';
      for (let i = 0; i < postMatrices.length; i++) posts.setMatrixAt(i, postMatrices[i]);
      posts.instanceMatrix.needsUpdate = true;
      posts.castShadow = true;
      group.add(posts);

      const matrix = new THREE.Matrix4();
      for (const [colour, list] of origins) {
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(LIVERY_PALETTE[colour].primary),
          roughness: 0.85,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        materials.push(material);
        const mesh = new THREE.InstancedMesh(panelGeometry, material, list.length);
        mesh.name = 'billboard';
        for (let i = 0; i < list.length; i++) {
          mesh.setMatrixAt(i, matrix.multiplyMatrices(list[i], panelLocal));
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true;
        group.add(mesh);
      }
    }
  }

  return { group, lamps, sidewalks, billboards, dispose };
}

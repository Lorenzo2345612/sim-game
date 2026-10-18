import * as THREE from 'three';
import type { Point2 } from '../track/geo';
import type { TrackDataV2 } from '../core/types';
import { createSurfaceMaterial } from './surfaceMaterials';

const DECK_THICKNESS = 0.6;
const DECK_DROP = 0.05; // deck top below the track surface
const WALL_THICKNESS = 0.5;
const BARRIER_OFFSET = 1.25;
const STONE_DIR = 'textures/stone/old-wall';
const STONE_TILE = 4; // metres per stone tile, as in cityRenderer
const SURFACE_UV = 10; // surface materials sample uv in metres / 10

interface TexSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
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

// BoxGeometry uv is 0..1 per face; rescale so one tile covers `unit` metres.
function scaleBoxUv(
  geometry: THREE.BufferGeometry, dx: number, dy: number, dz: number, unit: number,
): THREE.BufferGeometry {
  const sizes: [number, number][] = [
    [dz, dy], [dz, dy], [dx, dz], [dx, dz], [dx, dy], [dx, dy],
  ];
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let p = 0; p < sizes.length; p++) {
    const [w, h] = sizes[p];
    for (let k = 0; k < 4; k++) {
      const i = p * 4 + k;
      uv.setXY(i, (uv.getX(i) * w) / unit, (uv.getY(i) * h) / unit);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

interface WVert {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}

function geometryFrom(positions: number[], uvs: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// Causeway side wall: 0.5 m thick, top on the deck plane, bottom following the bed.
function buildWall(
  p0: Point2, p1: Point2, e0: number, e1: number, offset: number, side: number,
  terrainY: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  const samples = Math.max(4, Math.ceil(len / 2));
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz * side;
  const nz = ux * side;
  const lats = [offset - WALL_THICKNESS / 2, offset + WALL_THICKNESS / 2];
  const tops: WVert[][] = [];
  const bots: WVert[][] = [];
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    const u = (len * t) / STONE_TILE;
    const cx = p0[0] + dx * t;
    const cz = p0[1] + dz * t;
    const y = e0 + (e1 - e0) * t - DECK_DROP;
    const top: WVert[] = [];
    const bot: WVert[] = [];
    for (const lat of lats) {
      const x = cx + nx * lat;
      const z = cz + nz * lat;
      top.push({ x, y, z, u, v: y / STONE_TILE });
      // The abutment ground sits above the deck top, so the wall has no height there.
      const yb = Math.min(terrainY(x, z), y);
      bot.push({ x, y: yb, z, u, v: yb / STONE_TILE });
    }
    tops.push(top);
    bots.push(bot);
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const tri = (a: WVert, b: WVert, c: WVert): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    uvs.push(a.u, a.v, b.u, b.v, c.u, c.v);
  };
  const quad = (a: WVert, b: WVert, c: WVert, d: WVert): void => {
    tri(a, b, c);
    tri(a, c, d);
  };
  for (let k = 0; k < samples; k++) {
    const [t0, t1] = [tops[k], tops[k + 1]];
    const [b0, b1] = [bots[k], bots[k + 1]];
    quad(t0[0], t0[1], t1[1], t1[0]); // top
    quad(b0[0], b1[0], b1[1], b0[1]); // bottom
    quad(b0[0], b0[1], t0[1], t0[0]); // inner face
    quad(b1[0], b1[1], t1[1], t1[0]); // outer face
  }
  quad(bots[0][0], bots[0][1], tops[0][1], tops[0][0]);
  const last = samples;
  quad(bots[last][0], tops[last][0], tops[last][1], bots[last][1]);
  return geometryFrom(positions, uvs);
}

function buildBed(
  line: Point2[], width: number, terrainY: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const half = width / 2;
  const normals: Point2[] = [];
  for (let i = 0; i < line.length; i++) {
    let mx = 0;
    let mz = 0;
    for (const [a, b] of [
      [line[i - 1], line[i]],
      [line[i], line[i + 1]],
    ] as [Point2 | undefined, Point2 | undefined][]) {
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) continue;
      mx += -dz / len;
      mz += dx / len;
    }
    const len = Math.hypot(mx, mz) || 1;
    normals.push([mx / len, mz / len]);
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let along = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) along += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const [mx, mz] = normals[i];
    for (const s of [1, -1]) {
      const x = line[i][0] + mx * half * s;
      const z = line[i][1] + mz * half * s;
      positions.push(x, terrainY(x, z) + 0.05, z);
      uvs.push((half * s) / SURFACE_UV, along / SURFACE_UV);
    }
  }
  for (let i = 0; i + 1 < line.length; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createBridgeObject(
  track: TrackDataV2,
  terrainY: (x: number, z: number) => number,
): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'bridges';
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
  const bridges = track.bridges ?? [];
  const arroyos = track.arroyos ?? [];
  if (bridges.length === 0 && arroyos.length === 0) return { group, dispose };

  const stoneSet = loadSet(defaultLoadTexture, STONE_DIR);
  const stone = new THREE.MeshStandardMaterial({
    map: stoneSet.color,
    normalMap: stoneSet.normal,
    roughnessMap: stoneSet.roughness,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const concrete = createSurfaceMaterial('concrete', defaultLoadTexture);
  const gravel = createSurfaceMaterial('gravel', defaultLoadTexture);
  materials.push(stone, concrete, gravel);
  textures.push(stoneSet.color, stoneSet.normal, stoneSet.roughness);
  for (const m of [concrete, gravel]) {
    for (const t of (m.userData as { textures: THREE.Texture[] }).textures) textures.push(t);
  }

  const halfWidth = track.widthMeters / 2;
  const offset = halfWidth + BARRIER_OFFSET;
  const deckWidth = track.widthMeters + 2;
  const centerline = track.centerline;
  const elevation = track.elevation;
  const basis = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const origin = new THREE.Vector3();

  for (const b of bridges) {
    if (b.from < 0 || b.to >= centerline.length || b.to <= b.from) continue;
    const p0 = centerline[b.from];
    const p1 = centerline[b.to];
    const e0 = elevation[b.from];
    const e1 = elevation[b.to];
    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const pitch = Math.atan2(e1 - e0, len);
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    xAxis.set(ux * c, s, uz * c);
    yAxis.set(-ux * s, c, -uz * s);
    zAxis.set(-uz, 0, ux);
    basis.makeBasis(xAxis, yAxis, zAxis);
    origin
      .set((p0[0] + p1[0]) / 2, (e0 + e1) / 2 - DECK_DROP, (p0[1] + p1[1]) / 2)
      .addScaledVector(yAxis, -DECK_THICKNESS / 2);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);

    const deck = new THREE.Mesh(
      scaleBoxUv(new THREE.BoxGeometry(len, DECK_THICKNESS, deckWidth), len, DECK_THICKNESS, deckWidth, SURFACE_UV),
      concrete,
    );
    deck.position.copy(origin);
    deck.quaternion.copy(quaternion);
    group.add(deck);
    geometries.push(deck.geometry);

    // No parapets: the armco barriers of the span render through the barrier renderer.
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(buildWall(p0, p1, e0, e1, offset, side, terrainY), stone);
      group.add(wall);
      geometries.push(wall.geometry);
    }
  }

  for (const a of arroyos) {
    if (a.line.length < 2) continue;
    const bed = new THREE.Mesh(buildBed(a.line, a.width, terrainY), gravel);
    group.add(bed);
    geometries.push(bed.geometry);
  }

  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return { group, dispose };
}

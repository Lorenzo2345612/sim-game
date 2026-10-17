import * as THREE from 'three';
import type { Grandstand } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';

const ROW_RISE = 0.8;
const ROW_DEPTH = 0.9;
const SEAT_SPACING = 0.6;
const ROOF_CLEARANCE = 0.9;
const ROOF_THICKNESS = 0.2;
const POST_SIZE = 0.3;
const QUAD_SIZE = 0.9;
const OCCUPANCY = 0.85;
const ATLAS_GRID = 8;
const ATLAS_URL = '/textures/crowd/atlas.png';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function defaultLoadTexture(url: string): THREE.Texture {
  // TextureLoader needs a DOM; fall back to a plain texture under Node.
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

interface Seat {
  x: number;
  y: number;
  z: number;
}

export function seatPositions(g: Grandstand): Seat[] {
  const length = Math.max(0, g.lengthMeters);
  const rows = Math.max(0, Math.floor(g.rows));
  const perRow = Math.max(0, Math.floor(length / SEAT_SPACING));
  const seats: Seat[] = [];
  if (perRow === 0) return seats;
  const spacing = length / perRow;
  for (let row = 0; row < rows; row++) {
    // Float32 metres so an instanceMatrix (Float32Array) round-trips the seat exactly.
    const y = Math.fround((row + 1) * ROW_RISE);
    const z = Math.fround((row + 0.5) * ROW_DEPTH);
    for (let seat = 0; seat < perRow; seat++) {
      seats.push({ x: Math.fround(-length / 2 + (seat + 0.5) * spacing), y, z });
    }
  }
  return seats;
}

// Quad origin at the bottom centre, front face toward local -Z (the track).
function crowdQuad(): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(QUAD_SIZE, QUAD_SIZE);
  quad.translate(0, QUAD_SIZE / 2, 0);
  quad.rotateY(Math.PI);
  const uv = quad.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return quad;
}

const disposedGroups = new WeakSet<THREE.Group>();

export function createGrandstand(
  g: Grandstand,
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
  style?: ResolvedTrackStyle,
): THREE.Group {
  const s = style?.grandstands;
  const group = new THREE.Group();
  group.name = 'grandstand';
  group.position.set(g.x, 0, g.z);
  group.rotation.y = g.yaw;

  const length = Math.max(0, g.lengthMeters);
  const rows = Math.max(0, Math.floor(g.rows));
  const depth = rows * ROW_DEPTH;
  const height = rows * ROW_RISE;

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  function add(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3): void {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.copy(position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const tierGeometry = new THREE.BoxGeometry(length, ROW_RISE, ROW_DEPTH);
  const concrete = new THREE.MeshStandardMaterial({ color: s?.structure ?? 0xb0b0b4, roughness: 0.9, metalness: 0 });
  geometries.push(tierGeometry);
  materials.push(concrete);
  for (let row = 0; row < rows; row++) {
    add(`tier_${row}`, tierGeometry, concrete, new THREE.Vector3(0, (row + 0.5) * ROW_RISE, (row + 0.5) * ROW_DEPTH));
  }

  if (g.roof) {
    const roofStyle = s?.roofStyle ?? 'flat';
    const roofGeometry = new THREE.BoxGeometry(length, ROOF_THICKNESS, depth + 2 * POST_SIZE);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: s?.roof ?? 0x70757a, roughness: 0.6, metalness: 0.3 });
    geometries.push(roofGeometry);
    materials.push(roofMaterial);
    const roofY = height + ROOF_CLEARANCE + ROOF_THICKNESS / 2;
    add('roof', roofGeometry, roofMaterial, new THREE.Vector3(0, roofY, depth / 2));
    const roofMesh = group.children[group.children.length - 1];
    roofMesh.userData.roofStyle = roofStyle;
    if (roofStyle !== 'flat' || s?.roof) roofMesh.name = 'standRoof';
    if (roofStyle === 'sail') roofMesh.rotation.x = -(8 * Math.PI) / 180;

    const postHeight = height + ROOF_CLEARANCE;
    const postGeometry = new THREE.BoxGeometry(POST_SIZE, postHeight, POST_SIZE);
    const postMaterial = s?.structure ? new THREE.MeshStandardMaterial({ color: s.structure, roughness: 0.6, metalness: 0.3 }) : roofMaterial;
    if (postMaterial !== roofMaterial) materials.push(postMaterial);
    geometries.push(postGeometry);
    for (const sideX of [-1, 1]) {
      for (const z of [-POST_SIZE / 2, depth + POST_SIZE / 2]) {
        add('roofPost', postGeometry, postMaterial, new THREE.Vector3(sideX * (length / 2 - POST_SIZE / 2), postHeight / 2, z));
      }
    }

    if (roofStyle === 'truss') {
      const trussGeometry = new THREE.BoxGeometry(length, ROOF_THICKNESS, POST_SIZE / 2);
      geometries.push(trussGeometry);
      for (let k = 0; k < 3; k++) {
        add('standTruss', trussGeometry, postMaterial, new THREE.Vector3(0, roofY - ROOF_THICKNESS, ((k + 0.5) / 3) * depth));
      }
    }
  }

  const seats = seatPositions(g);
  const count = Math.round(OCCUPANCY * rows * Math.floor(length / SEAT_SPACING));
  if (count > 0) {
    const personGeometry = crowdQuad();
    const atlas = loadTexture(ATLAS_URL);
    atlas.name = ATLAS_URL;
    atlas.colorSpace = THREE.SRGBColorSpace;
    // Atlas row 0 is the PNG top, so keep it at v = 0; cells offset uv by (col, row) / 8.
    atlas.flipY = false;
    atlas.repeat.set(1 / ATLAS_GRID, 1 / ATLAS_GRID);
    const crowdMaterial = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: 0.5,
      roughness: 0.9,
      metalness: 0,
    });
    crowdMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n\tvMapUv += aCell / ${ATLAS_GRID}.0;`);
    };
    crowdMaterial.customProgramCacheKey = () => 'crowd-atlas';
    geometries.push(personGeometry);
    materials.push(crowdMaterial);
    const crowd = new THREE.InstancedMesh(personGeometry, crowdMaterial, count);
    crowd.name = 'crowd';
    crowd.receiveShadow = true;
    crowd.frustumCulled = false;

    const rng = mulberry32(Math.round(g.x * 31 + g.z * 17));
    const order = seats.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    const cells = new Float32Array(count * 2);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const seat = order[i];
      matrix.makeTranslation(seat.x, seat.y, seat.z);
      crowd.setMatrixAt(i, matrix);
      color.setHSL(rng(), 0.3 + rng() * 0.3, 0.45 + rng() * 0.25);
      if (s?.seats) color.set(s.seats[i % s.seats.length]);
      crowd.setColorAt(i, color);
      const cell = Math.floor(rng() * ATLAS_GRID * ATLAS_GRID);
      cells[i * 2] = cell % ATLAS_GRID;
      cells[i * 2 + 1] = Math.floor(cell / ATLAS_GRID);
    }
    personGeometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    group.add(crowd);
  }

  return group;
}

export function disposeGrandstand(group: THREE.Group): void {
  if (disposedGroups.has(group)) return;
  disposedGroups.add(group);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const material = object.material;
    if (Array.isArray(material)) for (const m of material) materials.add(m);
    else materials.add(material);
  });
  for (const material of materials) {
    if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

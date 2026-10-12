import * as THREE from 'three';
import type { Grandstand } from '../core/types';

const ROW_RISE = 0.8;
const ROW_DEPTH = 0.9;
const SEAT_SPACING = 0.6;
const ROOF_CLEARANCE = 0.9;
const ROOF_THICKNESS = 0.2;
const POST_SIZE = 0.3;
const PERSON_SIZE: [number, number, number] = [0.35, 0.5, 0.3];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const disposedGroups = new WeakSet<THREE.Group>();

export function createGrandstand(g: Grandstand): THREE.Group {
  const group = new THREE.Group();
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
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb0b0b4, roughness: 0.9, metalness: 0 });
  geometries.push(tierGeometry);
  materials.push(concrete);
  for (let row = 0; row < rows; row++) {
    add(`tier_${row}`, tierGeometry, concrete, new THREE.Vector3(0, (row + 0.5) * ROW_RISE, (row + 0.5) * ROW_DEPTH));
  }

  if (g.roof) {
    const roofGeometry = new THREE.BoxGeometry(length, ROOF_THICKNESS, depth + 2 * POST_SIZE);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x70757a, roughness: 0.6, metalness: 0.3 });
    geometries.push(roofGeometry);
    materials.push(roofMaterial);
    add('roof', roofGeometry, roofMaterial, new THREE.Vector3(0, height + ROOF_CLEARANCE + ROOF_THICKNESS / 2, depth / 2));

    const postHeight = height + ROOF_CLEARANCE;
    const postGeometry = new THREE.BoxGeometry(POST_SIZE, postHeight, POST_SIZE);
    geometries.push(postGeometry);
    for (const sideX of [-1, 1]) {
      for (const z of [-POST_SIZE / 2, depth + POST_SIZE / 2]) {
        add('roofPost', postGeometry, roofMaterial, new THREE.Vector3(sideX * (length / 2 - POST_SIZE / 2), postHeight / 2, z));
      }
    }
  }

  const perRow = Math.max(0, Math.floor(length / SEAT_SPACING));
  const count = rows * perRow;
  if (count > 0) {
    const personGeometry = new THREE.BoxGeometry(...PERSON_SIZE);
    const crowdMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    geometries.push(personGeometry);
    materials.push(crowdMaterial);
    const crowd = new THREE.InstancedMesh(personGeometry, crowdMaterial, count);
    crowd.name = 'crowd';
    crowd.castShadow = true;
    crowd.frustumCulled = false;

    const rng = mulberry32(Math.round(g.x * 31 + g.z * 17));
    const spacing = length / perRow;
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let index = 0;
    for (let row = 0; row < rows; row++) {
      const y = (row + 1) * ROW_RISE + PERSON_SIZE[1] / 2;
      const z = (row + 0.5) * ROW_DEPTH;
      for (let seat = 0; seat < perRow; seat++) {
        matrix.makeTranslation(-length / 2 + (seat + 0.5) * spacing, y, z);
        crowd.setMatrixAt(index, matrix);
        color.setHSL(rng(), 0.4 + rng() * 0.4, 0.3 + rng() * 0.3);
        crowd.setColorAt(index, color);
        index++;
      }
    }
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
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const material = object.material;
    if (Array.isArray(material)) for (const m of material) materials.add(m);
    else materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

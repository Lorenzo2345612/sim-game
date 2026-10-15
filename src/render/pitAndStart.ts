import * as THREE from 'three';
import type { Terrain, TrackDataV2 } from '../core/types';
import { registerWhitePaint } from './sceneSetup';

export interface StartLights { object: THREE.Group; setLights(n: number): void }

const BUILDING_DEPTH = 8;
const BUILDING_HEIGHT = 4;
const EDGE_OFFSET = 10;
const DOOR_PERIOD = 15;
const MIN_DOORS = 10;
const DOOR_HEIGHT = 3;
const DOOR_THICKNESS = 0.1;
const PILLAR_SIZE = 0.6;
const PILLAR_OUT = 1;
const GANTRY_HEIGHT = 6.5;
const BEAM_THICKNESS = 1;
const LIGHT_COUNT = 5;
const LIGHT_SPACING = 0.9;
const LIGHT_RADIUS = 0.25;

// Left = tangent rotated 90° counter-clockwise seen from +Y.
function sideNormal(tx: number, tz: number, side: 'left' | 'right'): [number, number] {
  return side === 'left' ? [tz, -tx] : [-tz, tx];
}

function tangentYaw(track: TrackDataV2): number {
  const [x0, z0] = track.centerline[0];
  const [x1, z1] = track.centerline[1];
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  return Math.atan2(-(z1 - z0) / len, (x1 - x0) / len);
}

// Bilinear sample of the terrain grid; same convention as main.ts makeTerrainY
// (heights column-major, col * (rows + 1) + row, origin = centre).
function terrainY(t: Terrain, x: number, z: number): number {
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  const fx = Math.min(Math.max(((x - minX) / t.sizeX) * t.cols, 0), t.cols);
  const fz = Math.min(Math.max(((z - minZ) / t.sizeZ) * t.rows, 0), t.rows);
  const j = Math.min(Math.floor(fx), t.cols - 1);
  const i = Math.min(Math.floor(fz), t.rows - 1);
  const tx = fx - j;
  const tz = fz - i;
  const h00 = t.heights[j * vertexRows + i];
  const h10 = t.heights[(j + 1) * vertexRows + i];
  const h01 = t.heights[j * vertexRows + i + 1];
  const h11 = t.heights[(j + 1) * vertexRows + i + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

function pitPathLength(track: TrackDataV2): number {
  const { centerline, pit } = track;
  let length = 0;
  let i = pit.start;
  while (i !== pit.end) {
    const j = (i + 1) % centerline.length;
    length += Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
    i = j;
  }
  return length;
}

export function createPitBuilding(track: TrackDataV2): THREE.Group {
  const [sx, sz] = track.centerline[track.pit.start];
  const [ex, ez] = track.centerline[track.pit.end];
  const chordLength = Math.hypot(ex - sx, ez - sz) || 1;
  const dx = (ex - sx) / chordLength;
  const dz = (ez - sz) / chordLength;
  const yaw = Math.atan2(-dz, dx);
  const [nx, nz] = sideNormal(dx, dz, track.pit.side);

  const samples: number[] = [];
  const n = track.centerline.length;
  for (let i = track.pit.start; ; i = (i + 1) % n) {
    samples.push(track.elevation[i]);
    if (i === track.pit.end) break;
  }
  const near = track.widthMeters / 2 + EDGE_OFFSET;
  const far = near + BUILDING_DEPTH;
  if (track.terrain) {
    const corner = (u: number, v: number): number =>
      terrainY(track.terrain, sx + dx * u + nx * v, sz + dz * u + nz * v);
    const edges: Array<[number, number]> = [
      [0, near], [0, far], [chordLength, near], [chordLength, far],
      [chordLength / 2, near], [chordLength / 2, far],
      [0, (near + far) / 2], [chordLength, (near + far) / 2],
    ];
    for (const [u, v] of edges) {
      const h = corner(u, v);
      if (Number.isFinite(h)) samples.push(h);
    }
  }
  // Sink 0.3 m so it never floats, but keep the roof above every sample.
  const y = Math.min(...samples) - 0.3;
  const height = Math.max(BUILDING_HEIGHT, Math.max(...samples) - y + 0.1);

  const buildingGeometry = new THREE.BoxGeometry(chordLength, height, BUILDING_DEPTH);
  buildingGeometry.translate(0, height / 2, 0);
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: '#b8bcc0', roughness: 0.85 });
  registerWhitePaint(buildingMaterial);
  const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
  building.name = 'pit';
  const inset = track.widthMeters / 2 + EDGE_OFFSET + BUILDING_DEPTH / 2;
  building.position.set((sx + ex) / 2 + nx * inset, y, (sz + ez) / 2 + nz * inset);
  building.rotation.y = yaw;

  const garageCount = Math.max(MIN_DOORS, Math.floor(pitPathLength(track) / DOOR_PERIOD));
  const spacing = chordLength / garageCount;
  const doorGeometry = new THREE.BoxGeometry(Math.min(5, spacing * 0.75), DOOR_HEIGHT, DOOR_THICKNESS);
  const doorMaterial = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.9 });

  const group = new THREE.Group();
  group.userData.garageCount = garageCount;
  for (let i = 0; i < garageCount; i++) {
    const t = (i + 0.5) * spacing;
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.name = 'garageDoor';
    // Flush on the near face, protruding slightly so the dark panel stays visible.
    door.position.set(sx + dx * t + nx * near, y + DOOR_HEIGHT / 2, sz + dz * t + nz * near);
    door.rotation.y = yaw;
    group.add(door);
  }
  group.add(building);
  return group;
}

export function createStartGantry(track: TrackDataV2): THREE.Group {
  const half = track.widthMeters / 2;
  const pillarZ = half + PILLAR_OUT;
  const beamLength = track.widthMeters + 2 * (PILLAR_OUT + PILLAR_SIZE / 2);

  const material = new THREE.MeshStandardMaterial({ color: '#8a8f94', roughness: 0.7, metalness: 0.2 });
  registerWhitePaint(material);
  const pillarGeometry = new THREE.BoxGeometry(PILLAR_SIZE, GANTRY_HEIGHT, PILLAR_SIZE);
  pillarGeometry.translate(0, GANTRY_HEIGHT / 2, 0);
  const beamGeometry = new THREE.BoxGeometry(PILLAR_SIZE, BEAM_THICKNESS, beamLength);
  beamGeometry.translate(0, GANTRY_HEIGHT - BEAM_THICKNESS / 2, 0);

  const group = new THREE.Group();
  group.position.set(track.centerline[0][0], track.elevation[0], track.centerline[0][1]);
  group.rotation.y = tangentYaw(track);
  for (const sign of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeometry, material);
    pillar.name = 'gantry';
    pillar.position.z = sign * pillarZ;
    group.add(pillar);
  }
  const beam = new THREE.Mesh(beamGeometry, material);
  beam.name = 'gantry';
  group.add(beam);
  return group;
}

export function createStartLights(track: TrackDataV2): StartLights {
  const group = new THREE.Group();
  group.position.set(track.centerline[0][0], track.elevation[0], track.centerline[0][1]);
  group.rotation.y = tangentYaw(track);

  const geometry = new THREE.SphereGeometry(LIGHT_RADIUS, 12, 8);
  const materials: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < LIGHT_COUNT; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: '#ff0000',
      emissive: '#000000',
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'light';
    mesh.position.set(0, GANTRY_HEIGHT - BEAM_THICKNESS - LIGHT_RADIUS - 0.05, (i - (LIGHT_COUNT - 1) / 2) * LIGHT_SPACING);
    group.add(mesh);
    materials.push(material);
  }

  const setLights = (n: number): void => {
    const lit = Math.min(LIGHT_COUNT, Math.max(0, Math.floor(n)));
    for (let i = 0; i < materials.length; i++) {
      const on = i < lit;
      materials[i].emissive.setHex(on ? 0xff0000 : 0x000000);
      materials[i].emissiveIntensity = on ? 2 : 0;
    }
  };
  setLights(0);

  return { object: group, setLights };
}

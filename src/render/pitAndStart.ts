import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
import { terrainHeightAt } from '../track/ground';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../track/trackStyle';
import { bankTanAt } from '../track/surfaces';
import { registerWhitePaint } from './sceneSetup';

export interface StartLights { object: THREE.Group; setLights(n: number): void }

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

// Extrudes a (depth, height) profile along the chord; local z = depth axis, x = chord.
function profileRoof(chord: number, depth: number, top: (u: number) => number, folds: number, thickness: number): THREE.BufferGeometry {
  const steps = folds * 8;
  const shape = new THREE.Shape();
  shape.moveTo(0, top(0) - thickness);
  for (let k = 0; k <= steps; k++) shape.lineTo((depth * k) / steps, top(k / steps));
  for (let k = steps; k >= 0; k--) shape.lineTo((depth * k) / steps, top(k / steps) - thickness);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: chord, bevelEnabled: false });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(chord / 2, 0, 0);
  return geometry;
}

export function createPitBuilding(track: TrackDataV2, style?: ResolvedTrackStyle): THREE.Group {
  const p = (style ?? DEFAULT_TRACK_STYLE).pitBuilding;
  const [sx, sz] = track.centerline[track.pit.start];
  const [ex, ez] = track.centerline[track.pit.end];
  const chordLength = Math.hypot(ex - sx, ez - sz) || 1;
  const dx = (ex - sx) / chordLength;
  const dz = (ez - sz) / chordLength;
  const yaw = Math.atan2(-dz, dx);
  const [nx, nz] = sideNormal(dx, dz, track.pit.side);

  const samples: number[] = [];
  const n = track.centerline.length;
  const near = track.widthMeters / 2 + EDGE_OFFSET;
  const far = near + p.depthMeters;
  const sideSign = track.pit.side === 'right' ? 1 : -1;
  for (let i = track.pit.start; ; i = (i + 1) % n) {
    samples.push(track.elevation[i]);
    // Cross-slope of the ground beside the track at the building's offsets.
    const tanB = bankTanAt(track, i);
    if (tanB !== 0) {
      samples.push(track.elevation[i] + sideSign * near * tanB, track.elevation[i] + sideSign * far * tanB);
    }
    if (i === track.pit.end) break;
  }
  if (track.terrain) {
    const corner = (u: number, v: number): number =>
      terrainHeightAt(track.terrain, sx + dx * u + nx * v, sz + dz * u + nz * v);
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
  const height = Math.max(p.heightMeters, Math.max(...samples) - y + 0.1);

  const buildingGeometry = new THREE.BoxGeometry(chordLength, height, p.depthMeters);
  buildingGeometry.translate(0, height / 2, 0);
  const buildingMaterial = new THREE.MeshStandardMaterial({ color: p.facade, roughness: 0.85 });
  registerWhitePaint(buildingMaterial);
  const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
  building.name = 'pit';
  const inset = near + p.depthMeters / 2;
  building.position.set((sx + ex) / 2 + nx * inset, y, (sz + ez) / 2 + nz * inset);
  building.rotation.y = yaw;

  const doorHeight = Math.min(DOOR_HEIGHT, p.heightMeters / p.storeys);
  const garageCount = Math.max(MIN_DOORS, Math.floor(pitPathLength(track) / DOOR_PERIOD));
  const spacing = chordLength / garageCount;
  const doorGeometry = new THREE.BoxGeometry(Math.min(5, spacing * 0.75), doorHeight, DOOR_THICKNESS);
  const doorMaterial = new THREE.MeshStandardMaterial({ color: p.doors, roughness: 0.9 });

  const group = new THREE.Group();
  group.userData.garageCount = garageCount;
  group.userData.storeys = p.storeys;
  for (let i = 0; i < garageCount; i++) {
    const t = (i + 0.5) * spacing;
    const door = new THREE.Mesh(doorGeometry, doorMaterial);
    door.name = 'garageDoor';
    // Flush on the near face, protruding slightly so the dark panel stays visible.
    door.position.set(sx + dx * t + nx * near, y + doorHeight / 2, sz + dz * t + nz * near);
    door.rotation.y = yaw;
    group.add(door);
  }
  group.add(building);

  // Local +z of the extras points away from the track.
  const awayYaw = track.pit.side === 'right' ? yaw : yaw + Math.PI;
  const place = (mesh: THREE.Mesh, name: string, localY: number, localZ: number): void => {
    mesh.name = name;
    mesh.position.set((sx + ex) / 2 + nx * localZ, y + localY, (sz + ez) / 2 + nz * localZ);
    mesh.rotation.y = awayYaw;
    group.add(mesh);
  };

  if (p.glazing > 0 && p.storeys > 1) {
    const band = p.heightMeters - p.heightMeters / p.storeys;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(chordLength, p.glazing * band, 0.2),
      new THREE.MeshStandardMaterial({ color: '#5b7f95', transparent: true, opacity: 0.6, metalness: 0.8, roughness: 0.2 }),
    );
    place(glass, 'pitGlass', p.heightMeters / p.storeys + band / 2, near - 0.1);
  }

  const roofColor = p.roof ?? p.facade;
  const overhang = 4;
  const slab = 0.3;
  let roofGeometry: THREE.BufferGeometry | null = null;
  if (p.roofStyle === 'flat' && p.roof !== null) {
    roofGeometry = new THREE.BoxGeometry(chordLength, slab, p.depthMeters);
    roofGeometry.translate(0, slab / 2, p.depthMeters / 2);
  } else if (p.roofStyle === 'canopy') {
    roofGeometry = new THREE.BoxGeometry(chordLength, slab, p.depthMeters + overhang);
    roofGeometry.translate(0, 0.5 + slab / 2, (p.depthMeters - overhang) / 2);
  } else if (p.roofStyle === 'folded') {
    const folds = 4;
    const amplitude = 1.5;
    roofGeometry = profileRoof(chordLength, p.depthMeters, (t) => slab + (Math.floor(t * folds * 2) % 2 === 0 ? 0 : amplitude), folds, slab);
  } else if (p.roofStyle === 'sail') {
    const length = p.depthMeters + overhang;
    const angle = Math.min((8 * Math.PI) / 180, Math.asin(Math.min(1, 2 / length)));
    roofGeometry = new THREE.BoxGeometry(chordLength, slab, length);
    roofGeometry.rotateX(angle);
    roofGeometry.computeBoundingBox();
    roofGeometry.translate(0, -(roofGeometry.boundingBox as THREE.Box3).min.y, (p.depthMeters - overhang) / 2);
  } else if (p.roofStyle === 'curved') {
    const rise = 2;
    roofGeometry = profileRoof(chordLength, p.depthMeters, (t) => slab + (rise - slab) * Math.sin(Math.PI * t), 4, slab);
  }
  if (roofGeometry) {
    const roofMesh = new THREE.Mesh(roofGeometry, new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7 }));
    roofMesh.userData.roofStyle = p.roofStyle;
    place(roofMesh, 'pitRoof', height, near);
  }

  if (p.accent) {
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(chordLength, 0.6, 0.15),
      new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.6 }),
    );
    place(accent, 'pitAccent', height - 0.4, near - 0.075);
  }
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
  // Local +z is the right of the driving direction: each pillar base sits on the banked ground.
  const tanB = bankTanAt(track, 0);
  for (const sign of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeometry, material);
    pillar.name = 'gantry';
    pillar.position.y = sign * pillarZ * tanB;
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

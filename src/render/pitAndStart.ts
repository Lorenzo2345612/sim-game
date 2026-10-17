import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
import { pitBuildingPieces, type PitPiece } from '../track/placement';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../track/trackStyle';
import { bankTanAt } from '../track/surfaces';
import { registerWhitePaint } from './sceneSetup';

export interface StartLights { object: THREE.Group; setLights(n: number): void }

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

function roofGeometryFor(
  p: ResolvedTrackStyle['pitBuilding'], length: number,
): THREE.BufferGeometry | null {
  const depth = p.depthMeters;
  const overhang = 4;
  const slab = 0.3;
  if (p.roofStyle === 'flat' && p.roof !== null) {
    const g = new THREE.BoxGeometry(length, slab, depth);
    g.translate(0, slab / 2, depth / 2);
    return g;
  }
  if (p.roofStyle === 'canopy') {
    const g = new THREE.BoxGeometry(length, slab, depth + overhang);
    g.translate(0, 0.5 + slab / 2, (depth - overhang) / 2);
    return g;
  }
  if (p.roofStyle === 'folded') {
    const folds = 4;
    const amplitude = 1.5;
    return profileRoof(length, depth, (t) => slab + (Math.floor(t * folds * 2) % 2 === 0 ? 0 : amplitude), folds, slab);
  }
  if (p.roofStyle === 'sail') {
    const size = depth + overhang;
    const angle = Math.min((8 * Math.PI) / 180, Math.asin(Math.min(1, 2 / size)));
    const g = new THREE.BoxGeometry(length, slab, size);
    g.rotateX(angle);
    g.computeBoundingBox();
    g.translate(0, -(g.boundingBox as THREE.Box3).min.y, (depth - overhang) / 2);
    return g;
  }
  if (p.roofStyle === 'curved') {
    const rise = 2;
    return profileRoof(length, depth, (t) => slab + (rise - slab) * Math.sin(Math.PI * t), 4, slab);
  }
  return null;
}

function addPitPiece(
  group: THREE.Group, p: ResolvedTrackStyle['pitBuilding'], piece: PitPiece,
  doors: number, doorHeight: number, materials: { facade: THREE.MeshStandardMaterial; doors: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial | null; roof: THREE.MeshStandardMaterial | null; accent: THREE.MeshStandardMaterial | null },
): number {
  const { length, depth, baseY, yaw } = piece;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const toWorld = (lx: number, lz: number): [number, number] => [piece.x + lx * cos + lz * sin, piece.z - lx * sin + lz * cos];

  const height = p.heightMeters;
  const buildingGeometry = new THREE.BoxGeometry(length, height, depth);
  buildingGeometry.translate(0, height / 2, 0);
  const building = new THREE.Mesh(buildingGeometry, materials.facade);
  building.name = 'pit';
  building.position.set(piece.x, baseY, piece.z);
  building.rotation.y = yaw;
  group.add(building);

  if (baseY - piece.plinthBottom > 0.1) {
    const plinthHeight = baseY - piece.plinthBottom;
    const plinthGeometry = new THREE.BoxGeometry(length, plinthHeight, depth);
    plinthGeometry.translate(0, plinthHeight / 2, 0);
    const plinth = new THREE.Mesh(plinthGeometry, materials.facade);
    plinth.name = 'pitPlinth';
    plinth.position.set(piece.x, piece.plinthBottom, piece.z);
    plinth.rotation.y = yaw;
    group.add(plinth);
  }

  const spacing = length / doors;
  const doorGeometry = new THREE.BoxGeometry(Math.min(5, spacing * 0.75), doorHeight, DOOR_THICKNESS);
  for (let i = 0; i < doors; i++) {
    const t = (i + 0.5) * spacing;
    const [wx, wz] = toWorld(-length / 2 + t, -depth / 2);
    const door = new THREE.Mesh(doorGeometry, materials.doors);
    door.name = 'garageDoor';
    door.position.set(wx, baseY + doorHeight / 2, wz);
    door.rotation.y = yaw;
    group.add(door);
  }

  // lz is measured from the near face (local +z points away from the track).
  const place = (mesh: THREE.Mesh, name: string, localY: number, lz: number): void => {
    mesh.name = name;
    const [wx, wz] = toWorld(0, lz - depth / 2);
    mesh.position.set(wx, baseY + localY, wz);
    mesh.rotation.y = yaw;
    group.add(mesh);
  };

  if (p.glazing > 0 && p.storeys > 1 && materials.glass) {
    const band = p.heightMeters - p.heightMeters / p.storeys;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(length, p.glazing * band, 0.2),
      materials.glass,
    );
    place(glass, 'pitGlass', p.heightMeters / p.storeys + band / 2, -0.1);
  }

  if (materials.roof) {
    const g = roofGeometryFor(p, length);
    if (g) {
      const roofMesh = new THREE.Mesh(g, materials.roof);
      roofMesh.userData.roofStyle = p.roofStyle;
      place(roofMesh, 'pitRoof', height, 0);
    }
  }

  if (materials.accent) {
    const accent = new THREE.Mesh(new THREE.BoxGeometry(length, 0.6, 0.15), materials.accent);
    place(accent, 'pitAccent', height - 0.4, -0.075);
  }
  return doors;
}

export function createPitBuilding(track: TrackDataV2, style?: ResolvedTrackStyle): THREE.Group {
  const p = (style ?? DEFAULT_TRACK_STYLE).pitBuilding;
  const group = new THREE.Group();
  const pieces = pitBuildingPieces(track, style);
  if (pieces.length === 0) return group;

  const doorHeight = Math.min(DOOR_HEIGHT, p.heightMeters / p.storeys);
  const total = Math.max(MIN_DOORS, Math.floor(pitPathLength(track) / DOOR_PERIOD));
  const sumLength = pieces.reduce((sum, q) => sum + q.length, 0);
  const facadeMaterial = new THREE.MeshStandardMaterial({ color: p.facade, roughness: 0.85 });
  registerWhitePaint(facadeMaterial);
  const materials = {
    facade: facadeMaterial,
    doors: new THREE.MeshStandardMaterial({ color: p.doors, roughness: 0.9 }),
    glass: p.glazing > 0 && p.storeys > 1
      ? new THREE.MeshStandardMaterial({ color: '#5b7f95', transparent: true, opacity: 0.6, metalness: 0.8, roughness: 0.2 })
      : null,
    roof: p.roofStyle === 'flat' && p.roof === null
      ? null
      : new THREE.MeshStandardMaterial({ color: p.roof ?? p.facade, roughness: 0.7 }),
    accent: p.accent ? new THREE.MeshStandardMaterial({ color: p.accent, roughness: 0.6 }) : null,
  };

  let garageCount = 0;
  for (const piece of pieces) {
    garageCount += addPitPiece(
      group, p, piece, Math.max(1, Math.round((total * piece.length) / sumLength)), doorHeight, materials,
    );
  }
  group.userData.garageCount = garageCount;
  group.userData.storeys = p.storeys;
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

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { PitLane, TrackDataV2 } from '../../../src/core/types';
import { pitBuildingPieces } from '../../../src/track/placement';
import { createPitBuilding, createStartGantry, createStartLights } from '../../../src/render/pitAndStart';

const POINTS = 21;
const SPACING = 5;
const WIDTH = 12;
const HALF = WIDTH / 2;
const EPS = 1e-6;

// Straight track along +X; with tangent +X the right side is +Z.
function straightTrack(pit: PitLane, elevation = 0): TrackDataV2 {
  return {
    version: 2,
    id: 'test',
    name: 'Test',
    widthMeters: WIDTH,
    lengthMeters: (POINTS - 1) * SPACING,
    officialLengthMeters: 0,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * SPACING, 0]),
    sectors: [0, 0, 0],
    elevation: Array.from({ length: POINTS }, () => elevation),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit,
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com', dem: 'test.tif' },
  };
}

function meshesByName(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

function bbox(root: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(root);
}

describe('createPitBuilding', () => {
  it('right side: near face at width/2 + 10 on +Z', () => {
    const group = createPitBuilding(straightTrack({ start: 2, end: 18, side: 'right' }));
    const box = bbox(meshesByName(group, 'pit')[0]);
    expect(box.min.z).toBeCloseTo(HALF + 10, 6);
    expect(box.max.z).toBeCloseTo(HALF + 10 + 8, 6);
    expect(box.min.x).toBeCloseTo(10, 6);
    expect(box.max.x).toBeCloseTo(90, 6);
    expect(group.userData.garageCount).toBe(10);
  });

  it('left side: near face on -Z', () => {
    const group = createPitBuilding(straightTrack({ start: 2, end: 18, side: 'left' }));
    const box = bbox(meshesByName(group, 'pit')[0]);
    expect(box.max.z).toBeCloseTo(-(HALF + 10), 6);
    expect(box.min.z).toBeCloseTo(-(HALF + 10 + 8), 6);
    expect(box.min.x).toBeCloseTo(10, 6);
    expect(box.max.x).toBeCloseTo(90, 6);
  });

  it('wrapping range: the walk across the seam yields several pieces', () => {
    // The 21-point fixture jumps 100 → 0 at the seam, so the walk turns and splits into pieces.
    const track = straightTrack({ start: 15, end: 5, side: 'right' });
    const group = createPitBuilding(track);
    const pieces = pitBuildingPieces(track);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    expect(meshesByName(group, 'pit')).toHaveLength(pieces.length);
    expect(meshesByName(group, 'garageDoor')).toHaveLength(group.userData.garageCount as number);
  });

  it('one door mesh per garageCount, none named pit', () => {
    const group = createPitBuilding(straightTrack({ start: 2, end: 18, side: 'right' }));
    expect(meshesByName(group, 'pit')).toHaveLength(1);
    expect(meshesByName(group, 'garageDoor')).toHaveLength(group.userData.garageCount as number);
  });

  // Task 236: the facade stands on the highest ground of its footprint (no sink).
  // The fixture terrain is degenerate, so the track-plane elevation anchors it.
  it('building base sits on the highest ground', () => {
    const group = createPitBuilding(straightTrack({ start: 2, end: 18, side: 'right' }, 2.5));
    const box = bbox(meshesByName(group, 'pit')[0]);
    expect(box.min.y).toBeCloseTo(2.5, 6);
    expect(box.max.y).toBeCloseTo(6.5, 6);
  });
});

describe('createStartGantry', () => {
  it('spans the track at centerline[0] with top >= 6 m', () => {
    const group = createStartGantry(straightTrack({ start: 2, end: 18, side: 'right' }));
    const box = bbox(group);
    expect(meshesByName(group, 'gantry').length).toBeGreaterThanOrEqual(1);
    expect(box.min.z).toBeLessThanOrEqual(-HALF + EPS);
    expect(box.max.z).toBeGreaterThanOrEqual(HALF - EPS);
    expect(box.max.y).toBeGreaterThanOrEqual(6 - EPS);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
    expect(box.max.z - box.min.z).toBeGreaterThan(box.max.x - box.min.x);
  });

  it('elevation anchors the pillar base', () => {
    const group = createStartGantry(straightTrack({ start: 2, end: 18, side: 'right' }, 3));
    const box = bbox(group);
    expect(box.min.y).toBeCloseTo(3, 6);
  });

  it('beam follows a -Z tangent so it spans along X', () => {
    const track = straightTrack({ start: 2, end: 18, side: 'right' });
    track.centerline[0] = [0, 0];
    track.centerline[1] = [0, -SPACING];
    const box = bbox(createStartGantry(track));
    expect(box.min.x).toBeLessThanOrEqual(-HALF + EPS);
    expect(box.max.x).toBeGreaterThanOrEqual(HALF - EPS);
    expect(box.max.x - box.min.x).toBeGreaterThan(box.max.z - box.min.z);
  });
});

describe('createStartLights', () => {
  it('five lights with unique materials under the beam line', () => {
    const lights = createStartLights(straightTrack({ start: 2, end: 18, side: 'right' }));
    const meshes = meshesByName(lights.object, 'light');
    expect(meshes).toHaveLength(5);
    const materials = new Set(meshes.map((m) => m.material));
    expect(materials.size).toBe(5);
    for (const mesh of meshes) {
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(mesh.position.y).toBeLessThan(5.5);
      expect(mesh.position.y).toBeGreaterThan(0);
    }
  });

  it('setLights clamps to 0..5; n lights on for n = 0..5', () => {
    const lights = createStartLights(straightTrack({ start: 2, end: 18, side: 'right' }));
    const materials = meshesByName(lights.object, 'light').map((m) => m.material as THREE.MeshStandardMaterial);
    const lit = (): number => materials.filter((m) => m.emissiveIntensity > 0).length;
    for (let n = 0; n <= 5; n++) {
      lights.setLights(n);
      expect(lit()).toBe(n);
    }
    lights.setLights(9);
    expect(lit()).toBe(5);
    lights.setLights(-1);
    expect(lit()).toBe(0);
  });

  it('lights sit evenly along the lateral axis', () => {
    const lights = createStartLights(straightTrack({ start: 2, end: 18, side: 'right' }));
    const zs = meshesByName(lights.object, 'light').map((m) => m.position.z).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeCloseTo(0.9, 6);
    expect((zs[0] + zs[zs.length - 1]) / 2).toBeCloseTo(0, 6);
  });
});

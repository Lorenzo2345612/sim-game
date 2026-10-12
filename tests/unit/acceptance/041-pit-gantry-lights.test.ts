import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { createPitBuilding, createStartGantry, createStartLights } from '../../../src/render/pitAndStart';
import { fixture } from './022-fixture-trackdatav2';

const POINTS = 21;
const SPACING = 5;
const PIT_START_INDEX = 2;
const PIT_END_INDEX = 18;
const CHORD_X0 = PIT_START_INDEX * SPACING;
const CHORD_X1 = PIT_END_INDEX * SPACING;

// Straight fixture along +X; with tangent +X the right side is +Z
// (left = tangent rotated 90° counter-clockwise seen from +Y).
const track: TrackDataV2 = {
  ...fixture,
  widthMeters: 12,
  centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * SPACING, 0]),
  elevation: Array.from({ length: POINTS }, () => 0),
  pit: { start: PIT_START_INDEX, end: PIT_END_INDEX, side: 'right' },
};

const EPS = 1e-6;

function meshesByName(root: THREE.Object3D, name: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name === name) out.push(o);
  });
  return out;
}

function standardMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  return mesh.material as THREE.MeshStandardMaterial;
}

describe('041 pit gantry lights acceptance', () => {
  it('AT1: building is a box along the pit range, 10 m from the track edge on pit.side, garage openings >= 10', () => {
    const group = createPitBuilding(track);
    expect(group).toBeInstanceOf(THREE.Group);
    const building = meshesByName(group, 'pit');
    expect(building).toHaveLength(1);
    const box = new THREE.Box3().setFromObject(building[0]);
    expect(box.min.z).toBeCloseTo(track.widthMeters / 2 + 10, 6);
    expect(box.max.z).toBeGreaterThan(box.min.z);
    expect(box.min.x).toBeCloseTo(CHORD_X0, 6);
    expect(box.max.x).toBeCloseTo(CHORD_X1, 6);
    expect(box.max.x - box.min.x).toBeGreaterThan(box.max.z - box.min.z);
    expect(group.userData.garageCount).toBeGreaterThanOrEqual(10);
  });

  it('AT2: gantry spans the track at centerline[0] with height >= 6 m', () => {
    const group = createStartGantry(track);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(meshesByName(group, 'gantry').length).toBeGreaterThanOrEqual(1);
    const box = new THREE.Box3().setFromObject(group);
    const half = track.widthMeters / 2;
    expect(box.min.z).toBeLessThanOrEqual(-half + EPS);
    expect(box.max.z).toBeGreaterThanOrEqual(half - EPS);
    expect(box.max.y).toBeGreaterThanOrEqual(6 - EPS);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(track.centerline[0][0], 6);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(track.centerline[0][1], 6);
    expect(box.max.z - box.min.z).toBeGreaterThan(box.max.x - box.min.x);
  });

  it('AT3: setLights(n) lights exactly n red materials emissive for n = 0..5, setLights(-1) turns all off', () => {
    const lights = createStartLights(track);
    expect(lights.object).toBeInstanceOf(THREE.Group);
    const meshes = meshesByName(lights.object, 'light');
    expect(meshes).toHaveLength(5);
    const materials = meshes.map(standardMaterial);
    const litCount = (): number => materials.filter((m) => m.emissiveIntensity > 0).length;
    for (let n = 0; n <= 5; n++) {
      lights.setLights(n);
      expect(litCount()).toBe(n);
      for (const material of materials) {
        if (material.emissiveIntensity > 0) expect(material.emissive.getHex()).toBe(0xff0000);
      }
    }
    lights.setLights(-1);
    expect(litCount()).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { fixture } from './022-fixture-trackdatav2';

// Straight fixture: 60 centerline points, 2 m spacing along -Z, flat elevation 0.
// Segments use indices 5..N so the wrapped normal formula is never evaluated at the seam.
const POINTS = 60;

function barrierTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [0, -2 * i]),
    lengthMeters: 236,
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function objectByName(group: THREE.Group, name: string): THREE.Object3D {
  let found: THREE.Object3D | undefined;
  group.traverse((object) => {
    if (!found && object.name === name) found = object;
  });
  if (!found) throw new Error(`missing object: ${name}`);
  return found;
}

function boundingBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('geometry has no bounding box');
  return box;
}

describe('038 barrier render acceptance', () => {
  it('AT1: armco mesh along the offset polyline, height 0.75 m, 25 ±1 posts every 4 m for a 100 m segment', () => {
    const { group } = createBarrierObject(
      barrierTrack([{ start: 5, end: 55, side: 'right', type: 'armco', offsetMeters: 10 }]),
    );
    const rail = objectByName(group, 'armco');
    if (!(rail instanceof THREE.Mesh)) throw new Error('armco is not a Mesh');
    const box = boundingBox(rail.geometry);
    expect(box.min.x).toBeCloseTo(10, 6);
    expect(box.max.x).toBeCloseTo(10, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(100, 6);
    expect(box.min.y).toBeCloseTo(0.45, 6);
    expect(box.max.y).toBeCloseTo(0.75, 6);
    const posts = objectByName(group, 'armcoPosts');
    if (!(posts instanceof THREE.InstancedMesh)) throw new Error('armcoPosts is not an InstancedMesh');
    expect(posts.count).toBeGreaterThanOrEqual(24);
    expect(posts.count).toBeLessThanOrEqual(26);
  });

  it('AT2: instanced tyre stacks every 1 m for a 40 m segment (40 ±1), 3 stacked high', () => {
    const { group } = createBarrierObject(
      barrierTrack([{ start: 5, end: 25, side: 'right', type: 'tyres', offsetMeters: 8 }]),
    );
    const tyres = objectByName(group, 'tyres');
    if (!(tyres instanceof THREE.InstancedMesh)) throw new Error('tyres is not an InstancedMesh');
    expect(tyres.count).toBeGreaterThanOrEqual(39);
    expect(tyres.count).toBeLessThanOrEqual(41);
    const box = boundingBox(tyres.geometry);
    expect(box.max.y - box.min.y).toBeCloseTo(0.75, 6);
  });

  it('AT3: wall mesh is 1.0 m high and 0.3 m thick', () => {
    const { group } = createBarrierObject(
      barrierTrack([{ start: 5, end: 25, side: 'right', type: 'wall', offsetMeters: 12 }]),
    );
    const wall = objectByName(group, 'wall');
    if (!(wall instanceof THREE.Mesh)) throw new Error('wall is not a Mesh');
    const box = boundingBox(wall.geometry);
    expect(box.max.y - box.min.y).toBeCloseTo(1, 6);
    expect(box.max.x - box.min.x).toBeCloseTo(0.3, 6);
  });

  it('AT4: dispose() disposes all geometries and materials of every barrier type', () => {
    const { group, dispose } = createBarrierObject(
      barrierTrack([
        { start: 5, end: 15, side: 'right', type: 'armco', offsetMeters: 10 },
        { start: 20, end: 25, side: 'left', type: 'tyres', offsetMeters: 8 },
        { start: 30, end: 40, side: 'right', type: 'wall', offsetMeters: 12 },
      ]),
    );
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    group.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.push(object.geometry);
      const material = object.material as THREE.Material | THREE.Material[];
      for (const single of Array.isArray(material) ? material : [material]) {
        materials.push(single);
      }
    });
    expect(geometries.length).toBeGreaterThan(0);
    expect(materials.length).toBeGreaterThan(0);
    const spies = [
      ...geometries.map((geometry) => vi.spyOn(geometry, 'dispose')),
      ...materials.map((material) => vi.spyOn(material, 'dispose')),
    ];
    dispose();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });
});

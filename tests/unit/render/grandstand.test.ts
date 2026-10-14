import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Grandstand } from '../../../src/core/types';
import { createGrandstand, disposeGrandstand, seatPositions } from '../../../src/render/grandstand';

const INPUT: Grandstand = { x: 12, z: -30, yaw: 0.7, lengthMeters: 10, rows: 1, roof: true };

function named(group: THREE.Group, name: string): THREE.Object3D | undefined {
  return group.getObjectByName(name);
}

function crowdOf(group: THREE.Group): THREE.InstancedMesh {
  const crowd = named(group, 'crowd');
  if (!(crowd instanceof THREE.InstancedMesh)) throw new Error('missing instanced mesh: crowd');
  return crowd;
}

function colorsOf(crowd: THREE.InstancedMesh): number[] {
  if (!crowd.instanceColor) throw new Error('crowd has no instanceColor');
  return Array.from(crowd.instanceColor.array);
}

describe('createGrandstand', () => {
  it('applies x/z and yaw, y stays 0', () => {
    const group = createGrandstand(INPUT);
    expect(group.position.x).toBe(12);
    expect(group.position.z).toBe(-30);
    expect(group.position.y).toBe(0);
    expect(group.rotation.y).toBeCloseTo(0.7, 6);
  });

  it('one tier step per row: length along X, 0.8 m rise, 0.9 m depth', () => {
    const group = createGrandstand(INPUT);
    const tiers = group.children.filter((child) => child.name.startsWith('tier_'));
    expect(tiers).toHaveLength(1);
    const size = new THREE.Box3().setFromObject(tiers[0]).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(10, 5);
    expect(size.y).toBeCloseTo(0.8, 5);
    expect(size.z).toBeCloseTo(0.9, 5);
    expect(tiers[0].position.y).toBeCloseTo(0.4, 5);
    expect(tiers[0].position.z).toBeCloseTo(0.45, 5);
  });

  it('total height is rows * 0.8', () => {
    const group = createGrandstand({ ...INPUT, rows: 3 });
    const tiers = group.children.filter((child) => child.name.startsWith('tier_'));
    expect(tiers).toHaveLength(3);
    const top = Math.max(...tiers.map((tier) => tier.position.y + 0.4));
    expect(top).toBeCloseTo(2.4, 5);
  });

  it('roof mesh exists only when roof is true', () => {
    expect(named(createGrandstand(INPUT), 'roof')).toBeInstanceOf(THREE.Mesh);
    expect(named(createGrandstand({ ...INPUT, roof: false }), 'roof')).toBeUndefined();
    expect(named(createGrandstand({ ...INPUT, roof: false }), 'crowd')).toBeInstanceOf(
      THREE.InstancedMesh,
    );
  });

  it('crowd has round(0.85 * rows * floor(length / 0.6)) instances with seeded distinct colours', () => {
    const crowd = crowdOf(createGrandstand(INPUT));
    const expected = Math.round(0.85 * INPUT.rows * Math.floor(INPUT.lengthMeters / 0.6));
    expect(crowd.count).toBe(expected);
    const colors = colorsOf(crowd);
    expect(colors).toHaveLength(crowd.count * 3);
    expect(new Set(colors).size).toBeGreaterThan(1);
    expect(colorsOf(crowdOf(createGrandstand(INPUT)))).toEqual(colors);
    expect(colorsOf(crowdOf(createGrandstand({ ...INPUT, x: 13 })))).not.toEqual(colors);
  });

  it('every instance translation equals a seatPositions entry', () => {
    const crowd = crowdOf(createGrandstand(INPUT));
    const seats = seatPositions(INPUT);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < crowd.count; i++) {
      crowd.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      expect(
        seats.some(
          (seat) =>
            Math.abs(seat.x - position.x) < 1e-6 &&
            Math.abs(seat.y - position.y) < 1e-6 &&
            Math.abs(seat.z - position.z) < 1e-6,
        ),
      ).toBe(true);
    }
  });
});

describe('disposeGrandstand', () => {
  it('disposes every geometry and material once, and is idempotent', () => {
    const group = createGrandstand(INPUT);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      materials.add(object.material as THREE.Material);
    });
    const geometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'));

    disposeGrandstand(group);
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1);
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(() => disposeGrandstand(group)).not.toThrow();
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

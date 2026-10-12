import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand } from '../../../src/core/types';
import { createGrandstand } from '../../../src/render/grandstand';

const INPUT: Grandstand = { x: 0, z: 0, yaw: 0, lengthMeters: 60, rows: 12, roof: true };

function crowdOf(group: THREE.Group): THREE.InstancedMesh {
  const crowd = group.getObjectByName('crowd');
  if (!(crowd instanceof THREE.InstancedMesh)) throw new Error('missing instanced mesh: crowd');
  return crowd;
}

function colorsOf(crowd: THREE.InstancedMesh): number[] {
  const attr = crowd.instanceColor;
  if (!attr) throw new Error('crowd has no instanceColor');
  return Array.from(attr.array);
}

describe('040 grandstands-crowd acceptance', () => {
  it('AT1: bounding box is ~60 m long and >= 6 m high and a roof mesh exists', () => {
    const group = createGrandstand(INPUT);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(Math.abs(size.x - 60)).toBeLessThanOrEqual(0.05 * 60);
    expect(size.y).toBeGreaterThanOrEqual(6);
    expect(group.getObjectByName('roof')).toBeInstanceOf(THREE.Mesh);
  });

  it('AT2: crowd is an InstancedMesh with rows * floor(length / 0.6) ±5 % instances and seeded random per-instance colours', () => {
    const crowd = crowdOf(createGrandstand(INPUT));
    const expected = INPUT.rows * Math.floor(INPUT.lengthMeters / 0.6);
    expect(Math.abs(crowd.count - expected)).toBeLessThanOrEqual(0.05 * expected);
    const colors = colorsOf(crowd);
    expect(colors).toHaveLength(crowd.count * 3);
    const distinct = new Set<string>();
    for (let i = 0; i < crowd.count; i++) {
      distinct.add(`${colors[i * 3]},${colors[i * 3 + 1]},${colors[i * 3 + 2]}`);
    }
    expect(distinct.size).toBeGreaterThan(1);
    expect(colorsOf(crowdOf(createGrandstand(INPUT)))).toEqual(colors);
  });

  it('AT3: with roof false there is no roof mesh', () => {
    const group = createGrandstand({ ...INPUT, roof: false });
    expect(group.getObjectByName('roof')).toBeUndefined();
  });
});

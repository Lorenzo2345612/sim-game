import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TreeInstances, TreeSpecies } from '../../../src/core/types';
import { createTreeField, type TreeFieldOptions, type TreeFactory } from '../../../src/render/treeField';

const LOD0_HEIGHT: Record<number, number> = { 1: 2, 2: 4, 3: 8 };

interface FactoryCall {
  preset: string;
  seed: number;
  leafFactor: number;
}

// LOD1 group is 10x taller than LOD0 so a wrong variant height in scaleForHeight is detectable.
function recordingFactory(calls: FactoryCall[]): TreeFactory {
  return (preset, seed, leafFactor) => {
    calls.push({ preset, seed, leafFactor });
    const base = LOD0_HEIGHT[seed] ?? 2;
    const height = leafFactor === 1 ? base : base * 10;
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(0.2, height, 0.2).translate(0, height / 2, 0);
    group.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
    return group;
  };
}

// name !== preset: lookups go by name, factory receives preset.
const SPECIES: TreeSpecies = { name: 'birch', preset: 'birch-preset', heightMeters: 10 };

function makeField(data: number[], options: Partial<TreeFieldOptions> = {}) {
  const calls: FactoryCall[] = [];
  const trees: TreeInstances[] = [{ species: 'birch', data }];
  const field = createTreeField(trees, [SPECIES], {
    factory: recordingFactory(calls),
    terrainY: () => 0,
    ...options,
  });
  return { calls, field };
}

describe('039 trees render edge', () => {
  it('EDGE1: factory is called per species with seeds 1,2,3, leafFactor 1 and 0.5, and species.preset', () => {
    const { calls, field } = makeField([0, 0, 1, 0]);
    expect(calls.length).toBe(6);
    expect([...new Set(calls.map((c) => c.preset))]).toEqual(['birch-preset']);
    expect([...new Set(calls.map((c) => c.seed))].sort()).toEqual([1, 2, 3]);
    for (const seed of [1, 2, 3]) {
      const forSeed = calls.filter((c) => c.seed === seed);
      expect(forSeed.length).toBe(2);
      expect([...new Set(forSeed.map((c) => c.leafFactor))].sort()).toEqual([0.5, 1]);
    }
    field.dispose();
  });

  it('EDGE2: instance i uses variant i % 3, matrix scales by that variant LOD0 height and follows data order', () => {
    const data: number[] = [];
    for (let i = 0; i < 6; i++) data.push(i * 10, 0, 2, 0);
    const { field } = makeField(data);
    const out = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      field.getInstanceMatrix('birch', i, out).decompose(position, quaternion, scale);
      expect(position.x).toBeCloseTo(i * 10, 6);
      const variantHeight = LOD0_HEIGHT[(i % 3) + 1];
      const expected = 2 * (10 / variantHeight);
      expect(scale.x).toBeCloseTo(expected, 6);
      expect(scale.y).toBeCloseTo(expected, 6);
      expect(scale.z).toBeCloseTo(expected, 6);
    }
    field.dispose();
  });

  it('EDGE3: species with empty data gives instanceCount 0, variantCount 3 and its 3 variants are still built', () => {
    const { calls, field } = makeField([]);
    expect(field.instanceCount('birch')).toBe(0);
    expect(field.variantCount('birch')).toBe(3);
    expect(calls.length).toBe(6);
    field.dispose();
  });

  it('EDGE4: LOD thresholds are exclusive — d == lodDistance is LOD1, d == farDistance is hidden, for negative x too', () => {
    const data = [200, 0, 1, 0, -250, 0, 1, 0, 1400, 0, 1, 0, -1500, 0, 1, 0, 1600, 0, 1, 0, -2000, 0, 1, 0];
    const { field } = makeField(data);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    expect(field.getInstanceLod('birch', 2)).toBe(1);
    expect(field.getInstanceLod('birch', 3)).toBe(-1);
    expect(field.getInstanceLod('birch', 4)).toBe(-1);
    expect(field.getInstanceLod('birch', 5)).toBe(-1);
    field.dispose();
  });

  it('EDGE5: LOD distance is horizontal, ignoring camera height', () => {
    const { field } = makeField([100, 0, 1, 0, 2000, 0, 1, 0]);
    field.update({ x: 0, y: 5000, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(-1);
    field.dispose();
  });

  it('EDGE6: lodDistance and farDistance options replace the 250 m / 1500 m defaults', () => {
    const data = [5, 0, 1, 0, 10, 0, 1, 0, 19, 0, 1, 0, 20, 0, 1, 0];
    const { field } = makeField(data, { lodDistance: 10, farDistance: 20 });
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    expect(field.getInstanceLod('birch', 2)).toBe(1);
    expect(field.getInstanceLod('birch', 3)).toBe(-1);
    field.dispose();
  });

  it('EDGE7: repeated update calls re-evaluate LODs as the camera moves and return them on the way back', () => {
    const { field } = makeField([100, 0, 1, 0, 400, 0, 1, 0]);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    field.update({ x: 0, y: 0, z: 2000 });
    expect(field.getInstanceLod('birch', 0)).toBe(-1);
    expect(field.getInstanceLod('birch', 1)).toBe(-1);
    field.update({ x: 0, y: 0, z: 0 });
    expect(field.getInstanceLod('birch', 0)).toBe(0);
    expect(field.getInstanceLod('birch', 1)).toBe(1);
    field.dispose();
  });
});

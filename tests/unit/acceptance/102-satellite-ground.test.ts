import { describe, it, expect } from 'vitest';
import { groundUv, satelliteWeight } from '../../../src/render/terrainMaterial';

// Terrain rect not centred on the origin and non-square, so swapped u/v or a
// wrong corner would not cancel out.
const rect = { originX: 12.5, originZ: -7.5, sizeX: 400, sizeZ: 600 };
const MIN_X = rect.originX - rect.sizeX / 2;
const MAX_X = rect.originX + rect.sizeX / 2;
const MIN_Z = rect.originZ - rect.sizeZ / 2;
const MAX_Z = rect.originZ + rect.sizeZ / 2;

describe('102 satellite ground acceptance', () => {
  it('AT1: groundUv maps the terrain min corner to (0, 0) and the max corner to (1, 1)', () => {
    const lo = groundUv(rect, MIN_X, MIN_Z);
    expect(lo[0], 'u at min corner').toBeCloseTo(0, 6);
    expect(lo[1], 'v at min corner').toBeCloseTo(0, 6);
    const hi = groundUv(rect, MAX_X, MAX_Z);
    expect(hi[0], 'u at max corner').toBeCloseTo(1, 6);
    expect(hi[1], 'v at max corner').toBeCloseTo(1, 6);
  });

  it('AT2: satelliteWeight is 0 at 100 and 300 m, 1 at 600 m, smoothstep in between', () => {
    expect(satelliteWeight(100)).toBeCloseTo(0, 6);
    expect(satelliteWeight(300)).toBeCloseTo(0, 6);
    expect(satelliteWeight(375)).toBeCloseTo(0.15625, 6);
    expect(satelliteWeight(450)).toBeCloseTo(0.5, 6);
    expect(satelliteWeight(600)).toBeCloseTo(1, 6);
  });
});

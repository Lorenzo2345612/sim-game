import { describe, it, expect } from 'vitest';
import { placeTrees, type Biome } from '../../../tools/track-builder/trees';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, Terrain, TreeInstances } from '../../../src/core/types';

// Square track: 500 m side loop centred on the terrain origin.
function squareCenterline(): Point2[] {
  const pts: Point2[] = [];
  const half = 250;
  const step = 50;
  for (let x = -half; x < half; x += step) pts.push([x, -half]);
  for (let z = -half; z < half; z += step) pts.push([half, z]);
  for (let x = half; x > -half; x -= step) pts.push([x, half]);
  for (let z = half; z > -half; z -= step) pts.push([-half, z]);
  return pts;
}

const CENTERLINE = squareCenterline();

const TERRAIN: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 2000,
  sizeZ: 2000,
  rows: 2,
  cols: 2,
  heights: [0, 0, 0, 0],
};

const BARRIERS: BarrierSegment[] = [
  { start: 0, end: 9, side: 'left', type: 'armco', offsetMeters: 3 },
  { start: 10, end: 19, side: 'right', type: 'wall', offsetMeters: 5 },
];
const MAX_OFFSET = Math.max(...BARRIERS.map((b) => b.offsetMeters));
const EXCLUSION = MAX_OFFSET + 15;

const OAK_ASH: Biome = {
  species: [
    { name: 'oak', weight: 0.5 },
    { name: 'ash', weight: 0.5 },
  ],
  density: 0.5,
};

function countTrees(trees: TreeInstances[]): number {
  return trees.reduce((n, t) => n + t.data.length / 4, 0);
}

function distanceToCenterline(x: number, z: number): number {
  let min = Infinity;
  for (const [cx, cz] of CENTERLINE) {
    const d = Math.hypot(x - cx, z - cz);
    if (d < min) min = d;
  }
  return min;
}

describe('029 tree placement acceptance', () => {
  it('AT1: placeTrees twice with the same track id returns identical output', () => {
    const a: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, OAK_ASH);
    const b: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, OAK_ASH);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('AT2: every tree is farther from the centerline than max barrier offset + 15 m and inside terrain bounds', () => {
    const trees: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, OAK_ASH);
    expect(countTrees(trees)).toBeGreaterThan(0);
    const halfX = TERRAIN.sizeX / 2;
    const halfZ = TERRAIN.sizeZ / 2;
    for (const inst of trees) {
      for (let i = 0; i < inst.data.length; i += 4) {
        const x = inst.data[i];
        const z = inst.data[i + 1];
        expect(distanceToCenterline(x, z), `tree ${x},${z} too close`).toBeGreaterThan(EXCLUSION);
        expect(x, `tree ${x},${z} out of X bounds`).toBeGreaterThanOrEqual(TERRAIN.originX - halfX);
        expect(x, `tree ${x},${z} out of X bounds`).toBeLessThanOrEqual(TERRAIN.originX + halfX);
        expect(z, `tree ${x},${z} out of Z bounds`).toBeGreaterThanOrEqual(TERRAIN.originZ - halfZ);
        expect(z, `tree ${x},${z} out of Z bounds`).toBeLessThanOrEqual(TERRAIN.originZ + halfZ);
      }
    }
  });

  it('AT3: density 0 yields 0 trees, density 1 yields more than 0 and at most 6000', () => {
    const zero: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, { ...OAK_ASH, density: 0 });
    expect(countTrees(zero)).toBe(0);
    const full: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, { ...OAK_ASH, density: 1 });
    const total = countTrees(full);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(6000);
  });

  it('AT4: oak 0.5 / ash 0.5 with 2000+ trees splits each species 50% ±8%', () => {
    const trees: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, {
      ...OAK_ASH,
      density: 1,
    });
    const total = countTrees(trees);
    expect(total).toBeGreaterThanOrEqual(2000);
    for (const name of ['oak', 'ash']) {
      const inst = trees.find((t) => t.species === name);
      const count = inst ? inst.data.length / 4 : 0;
      const fraction = count / total;
      expect(fraction, `${name} fraction`).toBeGreaterThanOrEqual(0.42);
      expect(fraction, `${name} fraction`).toBeLessThanOrEqual(0.58);
    }
  });

  it('AT5: instance data is flat [x, z, scale, rotY] with scale in [0.85, 1.15] and rotY in [0, 2π)', () => {
    const trees: TreeInstances[] = placeTrees('monza', CENTERLINE, TERRAIN, BARRIERS, OAK_ASH);
    expect(countTrees(trees)).toBeGreaterThan(0);
    for (const inst of trees) {
      expect(inst.data.length % 4).toBe(0);
      for (let i = 0; i < inst.data.length; i += 4) {
        const scale = inst.data[i + 2];
        const rotY = inst.data[i + 3];
        expect(scale, `scale ${scale}`).toBeGreaterThanOrEqual(0.85);
        expect(scale, `scale ${scale}`).toBeLessThanOrEqual(1.15);
        expect(rotY, `rotY ${rotY}`).toBeGreaterThanOrEqual(0);
        expect(rotY, `rotY ${rotY}`).toBeLessThan(2 * Math.PI);
      }
    }
  });
});

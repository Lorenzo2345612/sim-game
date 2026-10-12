import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  bboxCenter,
  projectLonLat,
  unprojectXZ,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('023 geo unproject acceptance', () => {
  it('AT1: round trip of [9.281, 45.621] from origin [9.28, 45.62] returns the input within 1e-9', () => {
    const origin: LonLat = [9.28, 45.62];
    const point: LonLat = [9.281, 45.621];
    const projected = projectLonLat([point], origin)[0];
    const back = unprojectXZ(projected, origin);
    within(back[0], point[0], 1e-9);
    within(back[1], point[1], 1e-9);
  });

  it('AT2: unprojectXZ([0, -111195.08], [0, 0]) returns [0, 1] within 1e-6', () => {
    const result = unprojectXZ([0, -111195.08], [0, 0]);
    within(result[0], 0, 1e-6);
    within(result[1], 1, 1e-6);
  });

  it('AT3: round trip of 100 random points within ±0.05 deg of the Spa origin has max error < 1e-9 deg', () => {
    const root = resolve(__dirname, '../../..');
    const raw = readFileSync(resolve(root, 'assets/source/tracks/be-1925.geojson'), 'utf8');
    const fc = JSON.parse(raw) as {
      features: { geometry: { coordinates: [number, number][] } }[];
    };
    const origin = bboxCenter(fc.features[0].geometry.coordinates.slice(0, -1) as LonLat[]);
    const rand = mulberry32(20261012);
    let maxError = 0;
    for (let i = 0; i < 100; i++) {
      const point: LonLat = [
        origin[0] + (rand() * 2 - 1) * 0.05,
        origin[1] + (rand() * 2 - 1) * 0.05,
      ];
      const projected: Point2 = projectLonLat([point], origin)[0];
      const back = unprojectXZ(projected, origin);
      maxError = Math.max(maxError, Math.abs(back[0] - point[0]), Math.abs(back[1] - point[1]));
    }
    expect(maxError).toBeLessThan(1e-9);
  });
});

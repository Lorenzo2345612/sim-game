import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  bboxCenter,
  projectLonLat,
  polylineLength,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('004 geo projection acceptance', () => {
  it('AT1: projects 1 degree of latitude north to -111195 m on Z from origin [0, 0]', () => {
    const p = projectLonLat([[0, 1]], [0, 0])[0];
    within(p[0], 0, 1e-6);
    within(p[1], -111195, 1);
  });

  it('AT2: projects 1 degree of longitude east to +111195 m on X from origin [0, 0]', () => {
    const p = projectLonLat([[1, 0]], [0, 0])[0];
    within(p[0], 111195, 1);
    within(p[1], 0, 1e-6);
  });

  it('AT3: projects 0.001 deg of longitude at lat 45.62 to 77.77 m on X', () => {
    const p = projectLonLat([[9.281, 45.62]], [9.28, 45.62])[0];
    within(p[0], 77.77, 0.01);
    within(p[1], 0, 1e-6);
  });

  it('AT4: bboxCenter returns the centre of the bounding box', () => {
    const coords: LonLat[] = [
      [0, 0],
      [2, 4],
      [-2, 1],
    ];
    expect(bboxCenter(coords)).toEqual([0, 2]);
  });

  it('AT5: polylineLength gives 30 m open and 40 m closed for a 10x10 m square', () => {
    const sq: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    within(polylineLength(sq, false), 30, 1e-9);
    within(polylineLength(sq, true), 40, 1e-9);
  });

  it('AT6: closed projected length of it-1922 from bbox centre is 5786.6 m', () => {
    const root = resolve(__dirname, '../../..');
    const raw = readFileSync(resolve(root, 'assets/source/tracks/it-1922.geojson'), 'utf8');
    const fc = JSON.parse(raw) as {
      features: { geometry: { coordinates: [number, number][] } }[];
    };
    const coords = fc.features[0].geometry.coordinates.slice(0, -1) as LonLat[];
    const projected = projectLonLat(coords, bboxCenter(coords));
    within(polylineLength(projected, true), 5786.6, 1);
  });
});

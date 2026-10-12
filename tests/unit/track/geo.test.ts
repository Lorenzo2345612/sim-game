import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { bboxCenter, projectLonLat, polylineLength, EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';

describe('geo projection', () => {
  it('projects 1 degree of latitude north to about -111195 m on Z', () => {
    const [x, z] = projectLonLat([[0, 1]], [0, 0])[0];
    expect(x).toBeCloseTo(0, 6);
    expect(Math.abs(z - -111195)).toBeLessThan(1);
  });

  it('east is positive X and north is negative Z', () => {
    const [x] = projectLonLat([[0.001, 0]], [0, 0])[0];
    const [, z] = projectLonLat([[0, 0.001]], [0, 0])[0];
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
  });

  it('bboxCenter returns the middle of the bounding box', () => {
    expect(bboxCenter([[0, 0], [10, 4], [2, 8]])).toEqual([5, 4]);
  });

  it('polylineLength handles open and closed square', () => {
    const sq: Point2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(polylineLength(sq, false)).toBeCloseTo(30, 9);
    expect(polylineLength(sq, true)).toBeCloseTo(40, 9);
  });

  it('Monza closed length is about 5786.6 m', () => {
    const root = resolve(__dirname, '../../..');
    const raw = readFileSync(resolve(root, 'assets/source/tracks/it-1922.geojson'), 'utf8');
    const fc = JSON.parse(raw) as { features: { geometry: { coordinates: LonLat[] } }[] };
    const coords = fc.features[0].geometry.coordinates.slice(0, -1);
    const projected = projectLonLat(coords, bboxCenter(coords));
    expect(polylineLength(projected, true)).toBeCloseTo(5786.6, 0);
  });
});

describe('geo edge cases', () => {
  it('bboxCenter throws on empty coords', () => {
    expect(() => bboxCenter([])).toThrow(Error('bboxCenter: empty coords'));
  });

  it('bboxCenter of a single point is that point', () => {
    expect(bboxCenter([[9.28, 45.62]])).toEqual([9.28, 45.62]);
  });

  it('bboxCenter handles negative longitudes and latitudes', () => {
    expect(bboxCenter([[-10, -5], [-2, -9], [-6, -1]])).toEqual([-6, -5]);
  });

  it('projectLonLat returns a new array with same length and order', () => {
    const coords: LonLat[] = [[1, 2], [3, 4], [5, 6]];
    const out = projectLonLat(coords, [0, 0]);
    expect(out).not.toBe(coords);
    expect(out.length).toBe(coords.length);
    for (let i = 0; i < coords.length; i++) {
      expect(out[i][0]).toBeCloseTo((coords[i][0] - 0) * (EARTH_RADIUS_M * (Math.PI / 180)), 6);
      expect(out[i][1]).toBeCloseTo(-(coords[i][1] - 0) * (EARTH_RADIUS_M * (Math.PI / 180)), 6);
    }
  });

  it('projectLonLat does not mutate the input', () => {
    const coords: LonLat[] = [[1, 2], [3, 4]];
    projectLonLat(coords, [0, 0]);
    expect(coords).toEqual([[1, 2], [3, 4]]);
  });

  it('the origin projects to (0, 0)', () => {
    const [x, z] = projectLonLat([[9.28, 45.62]], [9.28, 45.62])[0];
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('longitude spacing shrinks by cos of the origin latitude', () => {
    const k = 6371008.8 * (Math.PI / 180);
    const [x] = projectLonLat([[1, 60]], [0, 60])[0];
    expect(x).toBeCloseTo(k * Math.cos((60 * Math.PI) / 180), 6);
    const [, z] = projectLonLat([[0, 61]], [0, 60])[0];
    expect(z).toBeCloseTo(-k, 6);
  });

  it('polylineLength is 0 for fewer than 2 points, open or closed', () => {
    expect(polylineLength([], false)).toBe(0);
    expect(polylineLength([], true)).toBe(0);
    expect(polylineLength([[1, 2]], false)).toBe(0);
    expect(polylineLength([[1, 2]], true)).toBe(0);
  });

  it('polylineLength doubles the segment for 2 points closed', () => {
    expect(polylineLength([[0, 0], [3, 4]], true)).toBeCloseTo(10, 9);
  });

  it('polylineLength uses exact 2D Euclidean distance', () => {
    expect(polylineLength([[0, 0], [3, 4], [3, 0]], false)).toBeCloseTo(9, 9);
  });

  it('polylineLength handles large coordinates without overflow', () => {
    const pts: Point2[] = [[-1e6, -1e6], [1e6, -1e6], [1e6, 1e6]];
    expect(polylineLength(pts, false)).toBeCloseTo(4e6, 3);
  });
});

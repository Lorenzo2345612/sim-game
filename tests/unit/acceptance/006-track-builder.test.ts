import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { bboxCenter, projectLonLat } from '../../../src/track/geo';
import {
  buildTrackData,
  type GeoJsonLineFeatureCollection,
  type TrackSourceConfig,
} from '../../../tools/track-builder/buildTrackData';

const CONFIG: TrackSourceConfig = { id: 'monza', name: 'Monza', widthMeters: 12, reverse: false };

const geojson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../assets/source/tracks/it-1922.geojson', import.meta.url)),
    'utf8',
  ),
) as GeoJsonLineFeatureCollection;

// Reference start: first geojson coordinate minus a repeated closing point, projected around the bbox centre.
const rawCoords = geojson.features[0].geometry.coordinates;
const firstRaw = rawCoords[0];
const lastRaw = rawCoords[rawCoords.length - 1];
const coords =
  firstRaw[0] === lastRaw[0] && firstRaw[1] === lastRaw[1] ? rawCoords.slice(0, -1) : rawCoords;
const startXY = projectLonLat([coords[0]], bboxCenter(coords))[0];

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function shoelace(points: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

describe('006 track-builder acceptance', () => {
  it('AT1: Monza data keeps id, name, width and the official length', () => {
    const data = buildTrackData(geojson, CONFIG);
    expect(data.id).toBe('monza');
    expect(data.name).toBe('Monza');
    expect(data.widthMeters).toBe(12);
    expect(data.officialLengthMeters).toBe(5793);
  });

  it('AT2: Monza length is within 1% of 5793 m', () => {
    const data = buildTrackData(geojson, CONFIG);
    expect(Math.abs(data.lengthMeters - 5793) / 5793).toBeLessThanOrEqual(0.01);
  });

  it('AT3: centerline has 2800-3000 points, last differs from first, spacing is 2 ±0.1 m', () => {
    const data = buildTrackData(geojson, CONFIG);
    const c = data.centerline;
    expect(c.length).toBeGreaterThanOrEqual(2800);
    expect(c.length).toBeLessThanOrEqual(3000);
    expect(c[c.length - 1]).not.toEqual(c[0]);
    for (let i = 0; i < c.length; i++) {
      const d = dist(c[i], c[(i + 1) % c.length]);
      expect(Math.abs(d - 2)).toBeLessThanOrEqual(0.1);
    }
  });

  it('AT4: sectors start at 0 and increase inside the centerline', () => {
    const data = buildTrackData(geojson, CONFIG);
    expect(data.sectors[0]).toBe(0);
    expect(data.sectors[1]).toBeGreaterThan(0);
    expect(data.sectors[1]).toBeLessThan(data.sectors[2]);
    expect(data.sectors[2]).toBeLessThan(data.centerline.length);
  });

  it('AT5: centerline[0] stays within 3 m of the projected start line', () => {
    const data = buildTrackData(geojson, CONFIG);
    expect(dist(data.centerline[0], startXY)).toBeLessThanOrEqual(3);
  });

  it('AT6: reverse flips the winding and keeps the start point', () => {
    const fwd = buildTrackData(geojson, CONFIG);
    const rev = buildTrackData(geojson, { ...CONFIG, reverse: true });
    expect(shoelace(fwd.centerline) * shoelace(rev.centerline)).toBeLessThan(0);
    expect(dist(rev.centerline[0], startXY)).toBeLessThanOrEqual(3);
  });

  it('AT7: source records the bacinger dataset, MIT license and url', () => {
    const data = buildTrackData(geojson, CONFIG);
    expect(data.source).toEqual({
      dataset: 'bacinger/f1-circuits',
      license: 'MIT',
      url: 'https://github.com/bacinger/f1-circuits',
    });
  });
});

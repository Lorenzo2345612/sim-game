import { existsSync, readFileSync } from 'node:fs';
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

const monza = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../assets/source/tracks/it-1922.geojson', import.meta.url)),
    'utf8',
  ),
) as GeoJsonLineFeatureCollection;
const square = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../fixtures/square.geojson', import.meta.url)), 'utf8'),
) as GeoJsonLineFeatureCollection;

function startXy(gj: GeoJsonLineFeatureCollection): Point2 {
  const raw = gj.features[0].geometry.coordinates;
  const coords = raw.map((c): [number, number] => [c[0], c[1]]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) coords.pop();
  return projectLonLat([coords[0]], bboxCenter(coords))[0];
}

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

const monzaStart = startXy(monza);

describe('buildTrackData', () => {
  it('monza has correct id and name', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.id).toBe('monza');
    expect(data.name).toBe('Monza');
    expect(data.widthMeters).toBe(12);
  });

  it('monza centerline has between 2800 and 3000 points', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.centerline.length).toBeGreaterThanOrEqual(2800);
    expect(data.centerline.length).toBeLessThanOrEqual(3000);
  });

  it('monza length is within 1% of 5793', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.lengthMeters).toBeGreaterThanOrEqual(5735);
    expect(data.lengthMeters).toBeLessThanOrEqual(5851);
    expect(data.officialLengthMeters).toBe(5793);
  });

  it('monza sectors are increasing and start at 0', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.sectors[0]).toBe(0);
    expect(data.sectors[1]).toBeGreaterThan(0);
    expect(data.sectors[1]).toBeLessThan(data.sectors[2]);
    expect(data.sectors[2]).toBeLessThan(data.centerline.length);
  });

  it('monza centerline last point differs from the first', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.centerline[data.centerline.length - 1]).not.toEqual(data.centerline[0]);
  });

  it('monza spacing is uniform', () => {
    const c = buildTrackData(monza, CONFIG).centerline;
    for (let i = 0; i < c.length; i++) {
      const d = dist(c[i], c[(i + 1) % c.length]);
      expect(Math.abs(d - 2)).toBeLessThanOrEqual(0.1);
    }
  });

  it('monza start line is preserved', () => {
    const fwd = buildTrackData(monza, CONFIG);
    const rev = buildTrackData(monza, { ...CONFIG, reverse: true });
    expect(dist(fwd.centerline[0], monzaStart)).toBeLessThanOrEqual(3);
    expect(dist(rev.centerline[0], monzaStart)).toBeLessThanOrEqual(3);
  });

  it('monza source fields', () => {
    const data = buildTrackData(monza, CONFIG);
    expect(data.source).toEqual({
      dataset: 'bacinger/f1-circuits',
      license: 'MIT',
      url: 'https://github.com/bacinger/f1-circuits',
    });
  });

  it('monza coordinates are rounded to 2 decimals', () => {
    const c = buildTrackData(monza, CONFIG).centerline;
    for (let i = 0; i < 10; i++) {
      for (const v of c[i]) {
        expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-6);
      }
    }
  });

  it('square fixture builds without throwing', () => {
    const data = buildTrackData(square, { id: 'square', name: 'Square', widthMeters: 12, reverse: false });
    expect(data.centerline.length).toBeGreaterThan(0);
  });

  it('reverse flips the winding', () => {
    const fwd = buildTrackData(monza, CONFIG);
    const rev = buildTrackData(monza, { ...CONFIG, reverse: true });
    expect(Math.sign(shoelace(fwd.centerline))).not.toBe(Math.sign(shoelace(rev.centerline)));
  });

  it('buildTrackData throws without features', () => {
    const empty: GeoJsonLineFeatureCollection = { type: 'FeatureCollection', features: [] };
    expect(() => buildTrackData(empty, CONFIG)).toThrow('buildTrackData: no features');
  });

  it('generated monza.json exists for the CLI output', () => {
    expect(existsSync(fileURLToPath(new URL('../../../public/tracks/monza.json', import.meta.url)))).toBe(true);
  });
});

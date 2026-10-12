import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  sampleDem,
  centerlineHeights,
  elevationProfile,
} from '../../../tools/track-builder/elevation';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { bboxCenter, type LonLat, type Point2 } from '../../../src/track/geo';
import {
  buildTrackData,
  type GeoJsonLineFeatureCollection,
  type TrackSourceConfig,
} from '../../../tools/track-builder/buildTrackData';

const ROOT = join(__dirname, '..', '..', '..');

// row i: lat = lat0 - i*dLat, row j: lon = lon0 + j*dLon; heights row-major
const GRID_2X2: DemGrid = {
  lon0: 0,
  lat0: 1,
  dLon: 1,
  dLat: 1,
  rows: 2,
  cols: 2,
  heights: [0, 10, 20, 30], // (lon,lat): (0,1)=0 (1,1)=10 (0,0)=20 (1,0)=30
};

function realTrack(id: string, source: string): { grid: DemGrid; centerline: Point2[]; origin: LonLat } {
  const grid = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'dem', `${id}.json`), 'utf8'),
  ) as DemGrid;
  const geojson = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'tracks', `${source}.geojson`), 'utf8'),
  ) as GeoJsonLineFeatureCollection;
  const config: TrackSourceConfig = { id, name: id, widthMeters: 12, reverse: false };
  return {
    grid,
    centerline: buildTrackData(geojson, config).centerline,
    origin: bboxCenter(geojson.features[0].geometry.coordinates as LonLat[]),
  };
}

function range(values: number[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

describe('025 DEM sampling and elevation profile acceptance', () => {
  it('AT1: sampleDem at the centre of a 2x2 grid returns the bilinear value 15', () => {
    expect(sampleDem(GRID_2X2, 0.5, 0.5)).toBeCloseTo(15, 9);
  });

  it('AT2: sampleDem outside the grid clamps to the nearest edge value and never returns NaN', () => {
    expect(sampleDem(GRID_2X2, 0.5, 1.2)).toBeCloseTo(5, 9); // north edge: mean of 0, 10
    expect(sampleDem(GRID_2X2, 0.5, -0.2)).toBeCloseTo(25, 9); // south edge: mean of 20, 30
    expect(sampleDem(GRID_2X2, -0.5, 0.5)).toBeCloseTo(10, 9); // west edge: mean of 0, 20
    expect(sampleDem(GRID_2X2, 1.5, 0.5)).toBeCloseTo(20, 9); // east edge: mean of 10, 30
    expect(sampleDem(GRID_2X2, -0.5, -0.5)).toBeCloseTo(20, 9); // SW corner
    expect(sampleDem(GRID_2X2, 10, 10)).toBeCloseTo(10, 9); // far NE corner
    for (const [lon, lat] of [
      [0.5, 1.2],
      [0.5, -0.2],
      [-0.5, 0.5],
      [1.5, 0.5],
      [-0.5, -0.5],
      [10, 10],
    ]) {
      expect(Number.isFinite(sampleDem(GRID_2X2, lon, lat))).toBe(true);
    }
  });

  it('AT3: elevationProfile with circular window 25 smooths a single spike to 4 at index 40 and 0 at index 0', () => {
    const raw = new Array<number>(100).fill(50);
    raw[40] = 150;
    const profile = elevationProfile(raw, 25);
    expect(profile).toHaveLength(100);
    expect(profile[40]).toBeCloseTo(4, 6); // smoothed 54 minus smoothed start 50
    expect(profile[0]).toBeCloseTo(0, 6);
  });

  it('AT4: Monza real-DEM profile range is between 5 and 30 m', () => {
    const { grid, centerline, origin } = realTrack('monza', 'it-1922');
    const profile = elevationProfile(centerlineHeights(grid, centerline, origin));
    const r = range(profile);
    expect(r).toBeGreaterThanOrEqual(5);
    expect(r).toBeLessThanOrEqual(30);
  });

  it('AT5: Spa real-DEM profile range is between 80 and 120 m', () => {
    const { grid, centerline, origin } = realTrack('spa', 'be-1925');
    const profile = elevationProfile(centerlineHeights(grid, centerline, origin));
    const r = range(profile);
    expect(r).toBeGreaterThanOrEqual(80);
    expect(r).toBeLessThanOrEqual(120);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  demTileName,
  demTileUrls,
  writeDemGrid,
  type Bbox,
  type DemReader,
  type RawWindow,
} from '../../../tools/dem/fetchDem';
import { bboxCenter, unprojectXZ, type LonLat } from '../../../src/track/geo';

const ROOT = join(__dirname, '..', '..', '..');

describe('024 dem fetch acceptance', () => {
  it('AT1: demTileName returns the Copernicus tile name for Monza, Spa and Silverstone coordinates', () => {
    expect(demTileName(9.28, 45.62)).toBe('N45_00_E009_00');
    expect(demTileName(5.97, 50.43)).toBe('N50_00_E005_00');
    expect(demTileName(-1.02, 52.07)).toBe('N52_00_W002_00');
  });

  it('AT2: demTileUrls returns exactly one Copernicus-pattern URL for a bbox crossing no tile edge', () => {
    const bbox: Bbox = [9.25, 45.6, 9.3, 45.65];
    const urls = demTileUrls(bbox);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N45_00_E009_00_DEM/Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif',
    );
  });

  it('AT3: writeDemGrid writes the window as JSON with rows 3, cols 4, heights row-major north to south, lon0/lat0 the north-west cell centre', async () => {
    const bbox: Bbox = [-1.05, 52.05, -1.0, 52.1];
    const heights = [
      100.1, 101.1, 102.1, 103.1, 110.2, 111.2, 112.2, 113.2, 120.3, 121.3, 122.3, 123.3,
    ];
    const window: RawWindow = {
      lon0: -1.0275,
      lat0: 52.086,
      dLon: 0.005,
      dLat: 0.004,
      rows: 3,
      cols: 4,
      heights,
    };
    const reader: DemReader = (bboxArg: Bbox): Promise<RawWindow> => {
      expect(bboxArg).toEqual(bbox);
      return Promise.resolve(window);
    };
    const dir = mkdtempSync(join(tmpdir(), 'dem-024-'));
    try {
      const outPath = join(dir, 'out', 'silverstone.json');
      const grid = await writeDemGrid(reader, bbox, outPath);
      const json = JSON.parse(readFileSync(outPath, 'utf8'));
      expect(json).toEqual({
        lon0: window.lon0,
        lat0: window.lat0,
        dLon: window.dLon,
        dLat: window.dLat,
        rows: 3,
        cols: 4,
        heights,
      });
      expect(Array.isArray(json.heights)).toBe(true);
      expect(grid).toEqual(json);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT4: committed monza, spa and silverstone DEM files exist, cover the track bbox plus 600 m, heights within 50-700 m, no NaN', () => {
    const tracks = [
      { id: 'monza', source: 'it-1922' },
      { id: 'spa', source: 'be-1925' },
      { id: 'silverstone', source: 'gb-1948' },
    ];
    // ~11 m at the equator; absorbs float/cosLat differences between the script and this test
    const TOL = 1e-4;
    for (const { id, source } of tracks) {
      const demPath = join(ROOT, 'assets', 'source', 'dem', `${id}.json`);
      expect(existsSync(demPath), `${id}.json missing`).toBe(true);
      const grid = JSON.parse(readFileSync(demPath, 'utf8')) as {
        lon0: number;
        lat0: number;
        dLon: number;
        dLat: number;
        rows: number;
        cols: number;
        heights: number[];
      };

      const fc = JSON.parse(
        readFileSync(join(ROOT, 'assets', 'source', 'tracks', `${source}.geojson`), 'utf8'),
      ) as { features: { geometry: { coordinates: [number, number][] } }[] };
      const coords = fc.features[0].geometry.coordinates as LonLat[];
      let lonMin = Infinity;
      let latMin = Infinity;
      let lonMax = -Infinity;
      let latMax = -Infinity;
      for (const [lon, lat] of coords) {
        lonMin = Math.min(lonMin, lon);
        lonMax = Math.max(lonMax, lon);
        latMin = Math.min(latMin, lat);
        latMax = Math.max(latMax, lat);
      }
      const center = bboxCenter(coords);
      const east = unprojectXZ([600, 0], center);
      const north = unprojectXZ([0, -600], center);
      const dLonDeg = east[0] - center[0];
      const dLatDeg = north[1] - center[1];

      const westEdge = grid.lon0 - grid.dLon / 2;
      const eastEdge = westEdge + grid.cols * grid.dLon;
      const northEdge = grid.lat0 + grid.dLat / 2;
      const southEdge = northEdge - grid.rows * grid.dLat;
      expect(westEdge, `${id} west`).toBeLessThanOrEqual(lonMin - dLonDeg + TOL);
      expect(eastEdge, `${id} east`).toBeGreaterThanOrEqual(lonMax + dLonDeg - TOL);
      expect(southEdge, `${id} south`).toBeLessThanOrEqual(latMin - dLatDeg + TOL);
      expect(northEdge, `${id} north`).toBeGreaterThanOrEqual(latMax + dLatDeg - TOL);

      for (const h of grid.heights) {
        expect(h, `${id} NaN height`).not.toBeNaN();
        expect(h, `${id} too low`).toBeGreaterThanOrEqual(50);
        expect(h, `${id} too high`).toBeLessThanOrEqual(700);
      }
    }
  });
});

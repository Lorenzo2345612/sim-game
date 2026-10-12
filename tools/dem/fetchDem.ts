import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bboxCenter, unprojectXZ, type LonLat } from '../../src/track/geo';

export type Bbox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
export interface DemGrid {
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
  rows: number;
  cols: number;
  heights: number[];
}
export interface RawWindow extends Omit<DemGrid, 'heights'> {
  heights: ArrayLike<number>;
}
export type DemReader = (bbox: Bbox) => Promise<RawWindow>;

const S3 = 'https://copernicus-dem-30m.s3.amazonaws.com';
const MARGIN_M = 600;

interface GeoJsonCollection {
  features: { geometry: { coordinates: LonLat[] } }[];
}

export function demTileName(lon: number, lat: number): string {
  const latDeg = Math.floor(lat);
  const lonDeg = Math.floor(lon);
  const latHemi = latDeg < 0 ? 'S' : 'N';
  const lonHemi = lonDeg < 0 ? 'W' : 'E';
  return `${latHemi}${String(Math.abs(latDeg)).padStart(2, '0')}_00_${lonHemi}${String(Math.abs(lonDeg)).padStart(3, '0')}_00`;
}

export function demTileUrls(bbox: Bbox): string[] {
  const urls: string[] = [];
  for (let lat = Math.floor(bbox[1]); lat <= Math.floor(bbox[3]); lat++) {
    for (let lon = Math.floor(bbox[0]); lon <= Math.floor(bbox[2]); lon++) {
      const name = demTileName(lon, lat);
      urls.push(
        `${S3}/Copernicus_DSM_COG_10_${name}_DEM/Copernicus_DSM_COG_10_${name}_DEM.tif`,
      );
    }
  }
  return urls;
}

export async function writeDemGrid(
  reader: DemReader,
  bbox: Bbox,
  outPath: string,
): Promise<DemGrid> {
  const raw = await reader(bbox);
  const grid: DemGrid = {
    lon0: raw.lon0,
    lat0: raw.lat0,
    dLon: raw.dLon,
    dLat: raw.dLat,
    rows: raw.rows,
    cols: raw.cols,
    heights: Array.from(raw.heights),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(grid));
  return grid;
}

const TRACKS = [
  { id: 'monza', source: 'it-1922' },
  { id: 'spa', source: 'be-1925' },
  { id: 'silverstone', source: 'gb-1948' },
];

function expandedBbox(source: string): Bbox {
  const fc = JSON.parse(
    readFileSync(join('assets/source/tracks', `${source}.geojson`), 'utf8'),
  ) as GeoJsonCollection;
  const coords = fc.features[0].geometry.coordinates;
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
  const east = unprojectXZ([MARGIN_M, 0], center);
  const north = unprojectXZ([0, -MARGIN_M], center);
  const dLon = east[0] - center[0];
  const dLat = north[1] - center[1];
  return [lonMin - dLon, latMin - dLat, lonMax + dLon, latMax + dLat];
}

const clampPx = (v: number, f: (x: number) => number, max: number) =>
  Math.min(max, Math.max(0, f(v)));

function makeReader(): DemReader {
  return async (bbox) => {
    const { fromUrl } = await import('geotiff');
    const urls = demTileUrls(bbox);
    if (urls.length !== 1) {
      throw new Error(
        `DEM window spans ${urls.length} tiles (${urls.join(', ')}); only single-tile windows are supported`,
      );
    }
    const tLon = Math.floor(bbox[0]);
    const tiff = await fromUrl(urls[0]);
    const image = await tiff.getImage();
    // Tiles at lat >= 50 N are stored 2400 px wide: 1.5 arcsec per column, 1 arcsec per row
    const north = Math.round(image.getOrigin()[1]);
    const dLonPx = image.getResolution()[0];
    const dLatPx = -image.getResolution()[1];
    const left = clampPx((bbox[0] - tLon) / dLonPx, Math.floor, image.getWidth());
    const right = clampPx((bbox[2] - tLon) / dLonPx, Math.ceil, image.getWidth());
    const top = clampPx((north - bbox[3]) / dLatPx, Math.floor, image.getHeight());
    const bottom = clampPx((north - bbox[1]) / dLatPx, Math.ceil, image.getHeight());
    const rasters = await image.readRasters({ window: [left, top, right, bottom] });
    const band = Array.isArray(rasters) ? rasters[0] : rasters;
    const rows = bottom - top;
    const cols = right - left;
    if (band.length !== rows * cols) {
      throw new Error(`got ${band.length} samples for a ${cols}x${rows} window`);
    }
    return {
      lon0: tLon + (left + 0.5) * dLonPx,
      lat0: north - (top + 0.5) * dLatPx,
      dLon: dLonPx,
      dLat: dLatPx,
      rows,
      cols,
      heights: Array.from(band, (v) => Math.round(v * 10) / 10),
    };
  };
}

async function main(): Promise<void> {
  const reader = makeReader();
  for (const track of TRACKS) {
    const bbox = expandedBbox(track.source);
    const outPath = join('assets/source/dem', `${track.id}.json`);
    const grid = await writeDemGrid(reader, bbox, outPath);
    console.log(`${track.id}: ${grid.cols}x${grid.rows} cells -> ${outPath}`);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

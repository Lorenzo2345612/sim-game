import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TrackDataV2 } from '../../src/core/types';
import { bboxCenter, unprojectXZ, type LonLat } from '../../src/track/geo';
import { buildCityEnv, type ExtractBbox, type OverpassElement } from './osmBuildings';

const KEEP_RADIUS_M = 600;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const FETCH_ROUNDS = 20;
const RETRY_DELAY_MS = 60000;

interface TrackConfig {
  id: string;
  geojson: string;
}

interface GeoJsonLineCollection {
  features: { geometry: { coordinates: [number, number][] } }[];
}

function trackConfig(id: string): TrackConfig {
  const configs = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
  ) as TrackConfig[];
  const config = configs.find((c) => c.id === id);
  if (!config) throw new Error(`track ${id} not found in tools/track-builder/tracks.json`);
  return config;
}

// The track JSON's local frame origin is bboxCenter of its source geojson (buildTrackData).
function trackFrame(id: string): { origin: LonLat; bbox: ExtractBbox } {
  const config = trackConfig(id);
  const fc = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'tracks', `${config.geojson}.geojson`), 'utf8'),
  ) as GeoJsonLineCollection;
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
  const dLon = unprojectXZ([KEEP_RADIUS_M, 0], center)[0] - center[0];
  const dLat = unprojectXZ([0, -KEEP_RADIUS_M], center)[1] - center[1];
  return {
    origin: center,
    bbox: [lonMin - dLon, latMin - dLat, lonMax + dLon, latMax + dLat],
  };
}

function overpassQuery(bbox: ExtractBbox): string {
  const b = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  return (
    `[out:json][timeout:300];(` +
    `way["building"](${b});` +
    `relation["building"](${b});` +
    `way["building:part"](${b});` +
    `way["historic"](${b});` +
    `relation["historic"](${b});` +
    `way["barrier"~"^(wall|city_wall)$"](${b});` +
    `way["natural"~"^(water|basin|coastline)$"](${b});` +
    `relation["natural"~"^(water|basin)$"](${b});` +
    `);out body geom qt;`
  );
}

async function fetchElements(
  id: string,
  cachePath: string,
  bbox: ExtractBbox,
): Promise<OverpassElement[]> {
  if (existsSync(cachePath)) {
    return (JSON.parse(readFileSync(cachePath, 'utf8')) as { elements: OverpassElement[] })
      .elements;
  }
  const query = overpassQuery(bbox);
  let lastError: unknown;
  for (let round = 0; round < FETCH_ROUNDS; round++) {
    for (const endpoint of ENDPOINTS) {
      try {
        console.log(`${id}: fetching from ${endpoint} (round ${round + 1})`);
        const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': 'sim-game-bake/1.0' },
          signal: AbortSignal.timeout(300000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        const parsed = JSON.parse(raw) as { elements: OverpassElement[] };
        if (parsed.elements.length === 0) throw new Error('empty result set');
        writeFileSync(cachePath, raw);
        console.log(`${id}: cached ${parsed.elements.length} elements -> ${cachePath}`);
        return parsed.elements;
      } catch (err) {
        lastError = err;
        console.log(`${id}: ${err instanceof Error ? err.message : err}`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw new Error(
    `Overpass fetch failed for ${id}: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

export interface BakeResult {
  buildings: number;
  walls: number;
  water: number;
}

export async function bakeCity(id: string): Promise<BakeResult> {
  const track = JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
  const { origin, bbox } = trackFrame(id);
  const cachePath = join(ROOT, 'assets', 'source', 'osm', `${id}-city.json`);
  const elements = await fetchElements(id, cachePath, bbox);
  const corridorLimit =
    track.widthMeters / 2 + Math.max(...track.barriers.map((b) => b.offsetMeters)) + 5;
  const env = buildCityEnv(elements, {
    origin,
    centerline: track.centerline,
    corridorLimit,
    keepRadius: KEEP_RADIUS_M,
    bbox,
  });
  const outPath = join(ROOT, 'public', 'tracks', `${id}-env.json`);
  writeFileSync(outPath, JSON.stringify(env));
  console.log(
    `${id}: ${env.buildings.length} buildings, ${env.walls.length} walls, ${env.water.length} water -> ${outPath}`,
  );
  return { buildings: env.buildings.length, walls: env.walls.length, water: env.water.length };
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) throw new Error('usage: npm run build:env -- <trackId> [...]');
  for (const id of ids) await bakeCity(id);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}

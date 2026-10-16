import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bboxCenter, projectLonLat, type LonLat, type Point2 } from '../../src/track/geo';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface TrackEntry {
  id: string;
  geojson: string;
}
interface GeoJsonLineFeatureCollection {
  features: { geometry: { coordinates: LonLat[] } }[];
}
export interface LocateResult {
  index: number;
  side: 'left' | 'right';
  distanceMeters: number;
}

export function trackOrigin(id: string): LonLat {
  const config = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
  ) as TrackEntry[];
  const entry = config.find((t) => t.id === id);
  if (entry === undefined) throw new Error(`unknown track id: ${id}`);
  const geojson = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'tracks', `${entry.geojson}.geojson`), 'utf8'),
  ) as GeoJsonLineFeatureCollection;
  return bboxCenter(geojson.features[0].geometry.coordinates);
}

export function locateIndex(track: { centerline: Point2[] }, x: number, z: number): LocateResult {
  const pts = track.centerline;
  if (pts.length === 0) throw new Error('locateIndex: empty centerline');
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(x - pts[i][0], z - pts[i][1]);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  const [cx, cz] = pts[index];
  const [nx, nz] = pts[(index + 1) % pts.length];
  // Y-up cross product of forward x vertex->point: >0 is left, 0 counts as right.
  const cross = (nz - cz) * (x - cx) - (nx - cx) * (z - cz);
  return { index, side: cross > 0 ? 'left' : 'right', distanceMeters: best };
}

function main(): void {
  const args = process.argv.slice(2);
  const [id] = args;
  try {
    const lat = Number(args[1]);
    const lon = Number(args[2]);
    if (id === undefined || args.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`bad args: ${args.join(' ') || '(none)'}; usage: track:locate <id> <lat> <lon>`);
    }
    const [[x, z]] = projectLonLat([[lon, lat]], trackOrigin(id));
    const track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
    ) as { centerline: Point2[] };
    const r = locateIndex(track, x, z);
    console.log(`${id}: index ${r.index}, side ${r.side}, distance ${r.distanceMeters.toFixed(3)} m`);
    console.log(JSON.stringify(r));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}

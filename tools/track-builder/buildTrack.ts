import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildTrackData } from './buildTrackData';
import type { GeoJsonLineFeatureCollection, TrackSourceConfig } from './buildTrackData';

interface TrackSource extends TrackSourceConfig { file: string }

const TRACKS: TrackSource[] = [
  { id: 'monza', name: 'Monza', widthMeters: 12, reverse: false, file: 'assets/source/tracks/it-1922.geojson' },
];

mkdirSync('public/tracks', { recursive: true });
for (const track of TRACKS) {
  const geojson = JSON.parse(readFileSync(track.file, 'utf8')) as GeoJsonLineFeatureCollection;
  const data = buildTrackData(geojson, track);
  const dev = Math.abs(data.lengthMeters - data.officialLengthMeters) / data.officialLengthMeters;
  if (dev > 0.01) {
    console.error(`${track.id}: length deviation ${(dev * 100).toFixed(2)}% exceeds 1%`);
    process.exitCode = 1;
  }
  writeFileSync(`public/tracks/${track.id}.json`, JSON.stringify(data));
  console.log(
    `${track.id}: ${data.centerline.length} points, ${data.lengthMeters} m (official ${data.officialLengthMeters} m, deviation ${(dev * 100).toFixed(2)}%)`,
  );
}

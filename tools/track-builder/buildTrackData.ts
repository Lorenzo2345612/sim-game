import type { TrackData } from '../../src/core/types';
import { bboxCenter, projectLonLat, polylineLength } from '../../src/track/geo';
import { catmullRomClosed, resampleClosed } from '../../src/track/centerline';

export interface TrackSourceConfig { id: string; name: string; widthMeters: number; reverse: boolean }

export interface GeoJsonLineFeatureCollection {
  type: 'FeatureCollection';
  features: { properties: { length?: number }; geometry: { type: 'LineString'; coordinates: [number, number][] } }[];
}

export function buildTrackData(geojson: GeoJsonLineFeatureCollection, config: TrackSourceConfig): TrackData {
  const feature = geojson.features[0];
  if (!feature) throw new Error('buildTrackData: no features');

  let coords: [number, number][] = feature.geometry.coordinates.map(
    (c): [number, number] => [c[0], c[1]],
  );
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) coords = coords.slice(0, -1);
  if (config.reverse) coords = [coords[0], ...coords.slice(1).reverse()];

  const pts = projectLonLat(coords, bboxCenter(coords));
  const smooth = catmullRomClosed(pts, 20, 0.5);
  const res = resampleClosed(smooth, 2.0).map(
    ([x, z]): [number, number] => [Math.round(x * 100) / 100, Math.round(z * 100) / 100],
  );

  const lengthMeters = Math.round(polylineLength(res, true) * 10) / 10;
  const officialLengthMeters = feature.properties.length ?? lengthMeters;
  const N = res.length;

  return {
    id: config.id,
    name: config.name,
    widthMeters: config.widthMeters,
    lengthMeters,
    officialLengthMeters,
    centerline: res,
    sectors: [0, Math.round(N / 3), Math.round((2 * N) / 3)],
    source: { dataset: 'bacinger/f1-circuits', license: 'MIT', url: 'https://github.com/bacinger/f1-circuits' },
  };
}

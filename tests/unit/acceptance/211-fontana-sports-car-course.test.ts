import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import {
  bboxCenter,
  polylineLength,
  projectLonLat,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const OVAL_WAY_IDS = [7002869, 355478205, 355478193];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

function loadRoval(): TrackDataV2 {
  const raw = readJson<unknown>('public/tracks/fontana-roval.json');
  return parseTrackData(raw) as TrackDataV2;
}

/** Origin the builder used: bbox center of the track's own geojson LineString (buildTrack.ts). */
function rovalOrigin(): LonLat {
  const geo = readJson<{ features: { geometry: { coordinates: [number, number][] } }[] }>(
    'assets/source/tracks/us-fontana-roval.geojson',
  );
  const coords = geo.features[0]?.geometry.coordinates;
  if (!coords || coords.length === 0) {
    throw new Error('us-fontana-roval.geojson: missing LineString coordinates');
  }
  return bboxCenter(coords);
}

function ovalPolylines(origin: LonLat): Point2[][] {
  const osm = readJson<{
    elements: { type: string; id: number; geometry?: { lon: number; lat: number }[] }[];
  }>('assets/source/osm/fontana-2022.json');
  return OVAL_WAY_IDS.map((id) => {
    const way = osm.elements.find((e) => e.type === 'way' && e.id === id);
    if (!way?.geometry || way.geometry.length < 2) {
      throw new Error(`fontana-2022.json: missing oval way ${id}`);
    }
    return projectLonLat(
      way.geometry.map((g): LonLat => [g.lon, g.lat]),
      origin,
    );
  });
}

function distToPolyline(p: Point2, poly: Point2[]): number {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dz - p[1]));
  }
  return best;
}

function distanceToOval(p: Point2, oval: Point2[][]): number {
  let best = Infinity;
  for (const poly of oval) best = Math.min(best, distToPolyline(p, poly));
  return best;
}

function signedArea(pts: Point2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

interface IndexEntry {
  id: string;
  name: string;
  country: string;
}

describe('211 fontana sports car course acceptance', () => {
  it('AT1: fontana-roval parses with parseTrackData and its closed centerline length is in [4500, 4770] m', () => {
    const raw = readJson<unknown>('public/tracks/fontana-roval.json');
    const track = parseTrackData(raw) as TrackDataV2;
    const length = polylineLength(track.centerline, true);
    expect(length).toBeGreaterThanOrEqual(4500);
    expect(length).toBeLessThanOrEqual(4770);
  });

  it('AT2: index.json has 19 entries with fontana "Fontana Interior" right before fontana-roval "Fontana Sports Car Course"', () => {
    const entries = readJson<IndexEntry[]>('public/tracks/index.json');
    expect(entries).toHaveLength(19);
    const fi = entries.findIndex((e) => e.id === 'fontana');
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(entries[fi].name).toBe('Fontana Interior');
    expect(entries[fi + 1]?.id).toBe('fontana-roval');
    expect(entries[fi + 1]?.name).toBe('Fontana Sports Car Course');
    expect(entries[fi + 1]?.country).toBe('United States');
  });

  it('AT3: fontana centerline has 1213 points with the master first, middle and last points within 1e-9', () => {
    const track = readJson<TrackDataV2>('public/tracks/fontana.json');
    const cx = track.centerline;
    expect(cx).toHaveLength(1213);
    const expected: Array<[number, number, number]> = [
      [0, 429.84, 30.64],
      [Math.floor(1213 / 2), -444.43, -40.78],
      [1212, 427.91, 31.18],
    ];
    for (const [i, x, z] of expected) {
      expect(Math.abs(cx[i][0] - x), `point ${i} x`).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(cx[i][1] - z), `point ${i} z`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT4: every fontana-roval index with |bank| over 0.5 deg is within 25 m of an OSM oval way', () => {
    const track = loadRoval();
    const bank = track.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(track.centerline.length);
    const oval = ovalPolylines(rovalOrigin());
    for (let i = 0; i < track.centerline.length; i++) {
      if (Math.abs((bank ?? [])[i] ?? 0) <= 0.5 * DEG) continue;
      expect(distanceToOval(track.centerline[i], oval), `index ${i}`).toBeLessThanOrEqual(25);
    }
  });

  it('AT5: fontana-roval max |bank| is in [13, 15] deg and |bank[0]| in [10, 12] deg', () => {
    const track = loadRoval();
    const bank = track.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(track.centerline.length);
    const arr = bank ?? [];
    const maxDeg = Math.max(...arr.map((b) => Math.abs(b))) / DEG;
    expect(maxDeg).toBeGreaterThanOrEqual(13);
    expect(maxDeg).toBeLessThanOrEqual(15);
    const startDeg = Math.abs(arr[0] ?? 0) / DEG;
    expect(startDeg).toBeGreaterThanOrEqual(10);
    expect(startDeg).toBeLessThanOrEqual(12);
  });

  it('AT6: the fraction of fontana-roval centerline indices within 25 m of an oval way is in [0.25, 0.55]', () => {
    const track = loadRoval();
    const oval = ovalPolylines(rovalOrigin());
    let near = 0;
    for (const p of track.centerline) {
      if (distanceToOval(p, oval) <= 25) near++;
    }
    const fraction = near / track.centerline.length;
    expect(fraction).toBeGreaterThanOrEqual(0.25);
    expect(fraction).toBeLessThanOrEqual(0.55);
  });

  it('AT7: fontana-roval signed centerline area has the same sign as daytona (counter-clockwise)', () => {
    const roval = loadRoval();
    const daytona = readJson<TrackDataV2>('public/tracks/daytona.json');
    expect(Math.sign(signedArea(roval.centerline))).toBe(Math.sign(signedArea(daytona.centerline)));
  });
});

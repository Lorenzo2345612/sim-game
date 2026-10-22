import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { bboxCenter, polylineLength, projectLonLat, type Point2 } from '../../../src/track/geo';
import { groundHeightAt } from '../../../src/track/ground';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TRACK_CHOICES } from '../../../src/ui/menu';

const ROOT = join(__dirname, '..', '..', '..');
const IDS = [
  'ermita-centro',
  'ermita-federal',
  'ermita-norte',
  'ermita-mixto',
  'ermita-poniente',
  'ermita-veloz',
] as const;
const NAMES = [
  'Ermita Centro',
  'Ermita Federal',
  'Ermita Norte',
  'Ermita Mixto',
  'Ermita Poniente',
  'Ermita Veloz',
] as const;

const PREEXISTING_IDS = [
  'monza',
  'spa',
  'silverstone',
  'mexico',
  'daytona',
  'lusail',
  'bahrain',
  'braselton',
  'elkhart',
  'sepang',
  'baku',
  'budapest',
  'singapore',
  'lasvegas',
  'spielberg',
  'fontana',
  'fontana-roval',
  'cleveland',
  'detroit',
];
const PREEXISTING_HASH =
  '89a4daeb776b6200d8497403de38ab3f94b400778c89a9c5b1ec937f5343d38c';

interface IndexRow {
  id: string;
  name: string;
  country: string;
  lengthKm: number;
  outline: number[][];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson<unknown>(`public/tracks/${id}.json`)) as TrackDataV2;
}

function sourcePolyline(id: string): Point2[] {
  const geo = readJson<{ features: { geometry: { coordinates: [number, number][] } }[] }>(
    `assets/source/tracks/mx-${id}.geojson`,
  );
  const coords = geo.features[0]?.geometry.coordinates;
  if (!coords || coords.length === 0) {
    throw new Error(`mx-${id}.geojson: missing LineString coordinates`);
  }
  return projectLonLat(coords, bboxCenter(coords));
}

function pointAtArc(pts: Point2[], s: number): Point2 {
  let remaining = s;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= seg || i === n - 1) {
      const t = seg === 0 ? 0 : Math.min(remaining / seg, 1);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= seg;
  }
  return pts[0];
}

function circumradius(a: Point2, b: Point2, c: Point2): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const doubleArea = Math.abs(
    (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
  );
  if (doubleArea < 1e-9) return Infinity;
  return (ab * bc * ca) / (2 * doubleArea);
}

function nearestIndex(track: TrackDataV2, x: number, z: number): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < track.centerline.length; i++) {
    const dx = track.centerline[i][0] - x;
    const dz = track.centerline[i][1] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

describe('241 ermita tracks acceptance', () => {
  it('AT1: each of the 6 tracks parses and its closed centerline length is within 1% of the projected geojson polyline and in [2400, 5100] m', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      const length = polylineLength(track.centerline, true);
      const source = polylineLength(sourcePolyline(id), true);
      expect(Math.abs(length - source) / source, `${id}: deviation vs geojson`).toBeLessThanOrEqual(0.01);
      expect(length, `${id}: length >= 2400`).toBeGreaterThanOrEqual(2400);
      expect(length, `${id}: length <= 5100`).toBeLessThanOrEqual(5100);
    }
  });

  it('AT2: index.json has the 6 ermita ids consecutive in table order with their names and country Mexico, and every pre-existing entry unchanged in relative order', () => {
    const entries = readJson<IndexRow[]>('public/tracks/index.json');
    const first = entries.findIndex((e) => e.id === IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    const block = entries.slice(first, first + IDS.length);
    expect(block.map((e) => e.id)).toEqual([...IDS]);
    expect(block.map((e) => e.name)).toEqual([...NAMES]);
    for (const e of block) {
      expect(e.country, `${e.id}: country`).toBe('Mexico');
    }
    const preexisting = entries.filter((e) => !e.id.startsWith('ermita-') && !['bathurst', 'jeddah', 'miami', 'longbeach'].includes(e.id));
    expect(preexisting.map((e) => e.id)).toEqual(PREEXISTING_IDS);
    const hash = createHash('sha256').update(JSON.stringify(preexisting)).digest('hex');
    expect(hash, 'pre-existing entries byte-equivalent').toBe(PREEXISTING_HASH);
  });

  it('AT3: TRACK_CHOICES contains the 6 ermita ids with their names, consecutive in table order', () => {
    const first = TRACK_CHOICES.findIndex((c) => c.id === IDS[0]);
    expect(first).toBeGreaterThanOrEqual(0);
    const block = TRACK_CHOICES.slice(first, first + IDS.length);
    expect(block.map((c) => c.id)).toEqual([...IDS]);
    expect(block.map((c) => c.name)).toEqual([...NAMES]);
  });

  it('AT5: the 3-point circumradius at every 10 m resample of each new centerline is at least 11 m', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      const lap = polylineLength(track.centerline, true);
      const count = Math.floor(lap / 10);
      const samples: Point2[] = [];
      for (let k = 0; k < count; k++) {
        samples.push(pointAtArc(track.centerline, k * 10));
      }
      for (let k = 0; k < count; k++) {
        const r = circumradius(
          samples[(k - 1 + count) % count],
          samples[k],
          samples[(k + 1) % count],
        );
        expect(r, `${id}: at ${k * 10} m`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('AT6: each new track has the table width 12 with half widths within it, environment desert and no banking', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      expect(track.widthMeters, `${id}: widthMeters`).toBe(12);
      for (const half of [track.halfWidthLeft, track.halfWidthRight]) {
        if (!half) continue;
        for (const v of half) {
          expect(v, `${id}: half width > 0`).toBeGreaterThan(0);
          expect(v, `${id}: half width <= widthMeters / 2`).toBeLessThanOrEqual(track.widthMeters / 2);
        }
      }
      expect(track.environment, `${id}: environment`).toBe('desert');
      expect((track.bank ?? []).every((b) => b === 0), `${id}: bank all 0`).toBe(true);
    }
  });

  it('AT7: each public/textures/ground/<id>.jpg is a 2048 x 2048 JPEG (SOF0/SOF2)', () => {
    for (const id of IDS) {
      const path = join(ROOT, 'public', 'textures', 'ground', `${id}.jpg`);
      expect(existsSync(path), `${id}: crop exists`).toBe(true);
      const size = jpegSize(readFileSync(path));
      expect(size, id).toEqual({ width: 2048, height: 2048 });
    }
  });

  it('AT8: every grandstand base is within 0.45 m of the ground and the pit range lies inside [0, length) after wrap', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      expect(track.grandstands.length, `${id}: grandstands present`).toBeGreaterThan(0);
      for (const g of track.grandstands) {
        const base = track.elevation[nearestIndex(track, g.x, g.z)];
        const ground = groundHeightAt(track, g.x, g.z);
        expect(Math.abs(base - ground), `${id}: stand at (${g.x}, ${g.z})`).toBeLessThanOrEqual(0.45);
      }
      const n = track.centerline.length;
      expect(track.pit.start, `${id}: pit.start >= 0`).toBeGreaterThanOrEqual(0);
      expect(track.pit.start, `${id}: pit.start < length`).toBeLessThan(n);
      expect(track.pit.end, `${id}: pit.end >= 0`).toBeGreaterThanOrEqual(0);
      expect(track.pit.end, `${id}: pit.end < length`).toBeLessThan(n);
    }
  });

  it('AT10: ASSETS_LICENSES.md has rows naming ermita.json, each ground/ermita-<id>.jpg and the mx-ermita-* files', () => {
    const rows = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('|'));
    const hasRow = (needle: string): boolean => rows.some((line) => line.includes(needle));
    expect(hasRow('ermita.json'), 'DEM row naming ermita.json').toBe(true);
    for (const id of IDS) {
      expect(hasRow(`ground/${id}.jpg`), `${id} ground crop row`).toBe(true);
    }
    expect(hasRow('mx-ermita-'), 'row naming the mx-ermita-* files').toBe(true);
  });
});

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOG_TABLE, ENV_TABLE } from '../../../src/render/environment';
import type { TrackDataV2 } from '../../../src/core/types';
import { TRACK_CHOICES } from '../../../src/ui/menu';
import { bboxCenter, projectLonLat, type LonLat, type Point2 } from '../../../src/track/geo';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const OVAL_WAY_IDS = [7002869, 355478205, 355478193];

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

interface RegistryEntry {
  id: string;
  name: string;
  country: string;
  geojson: string;
  source: unknown;
  dem: string;
  maxGrade: number;
  widthMeters: number;
  environment: string;
  biome: unknown;
  banking?: { fromMeters: number; toMeters: number; degrees: number; raisedSide: string }[];
  grandstands?: unknown[];
  pit?: { fromMeters: number; toMeters: number; side: string };
}

function registryEntry(id: string): RegistryEntry {
  const entries = readJson<RegistryEntry[]>('tools/track-builder/tracks.json');
  const found = entries.find((e) => e.id === id);
  if (!found) throw new Error(`tracks.json: missing ${id} entry`);
  return found;
}

function loadRoval(): TrackDataV2 {
  const raw = readJson<unknown>('public/tracks/fontana-roval.json');
  return parseTrackData(raw) as TrackDataV2;
}

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

describe('211 fontana-roval edge cases', () => {
  it('EDGE1: every fontana-roval bank value is in [0 deg, 14 deg] (all raisedSide right, turns cap at 14 deg)', () => {
    const bank = loadRoval().bank ?? [];
    expect(bank.length).toBeGreaterThan(0);
    for (let i = 0; i < bank.length; i++) {
      expect(bank[i], `index ${i}`).toBeGreaterThanOrEqual(-1e-12);
      expect(Math.abs(bank[i]), `index ${i}`).toBeLessThanOrEqual(14 * DEG + 1e-9);
    }
  });

  it('EDGE2: every fontana-roval index with non-zero bank (not only above 0.5 deg) is within 25 m of an oval way', () => {
    const track = loadRoval();
    const bank = track.bank ?? [];
    expect(bank).toHaveLength(track.centerline.length);
    const oval = ovalPolylines(rovalOrigin());
    for (let i = 0; i < track.centerline.length; i++) {
      if (Math.abs(bank[i]) <= 0) continue;
      expect(distanceToOval(track.centerline[i], oval), `index ${i}`).toBeLessThanOrEqual(25);
    }
  });

  it('EDGE3: tracks.json fontana-roval banking uses only raisedSide right and degrees exactly 11 or 14, both present', () => {
    const banking = registryEntry('fontana-roval').banking;
    expect(Array.isArray(banking), 'banking array').toBe(true);
    const ranges = banking ?? [];
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    for (const r of ranges) {
      expect(r.raisedSide, `range ${r.fromMeters}..${r.toMeters}`).toBe('right');
      expect([11, 14], `range ${r.fromMeters}..${r.toMeters}`).toContain(r.degrees);
    }
    const degrees = ranges.map((r) => r.degrees);
    expect(degrees).toContain(11);
    expect(degrees).toContain(14);
  });

  it('EDGE4: the built fontana-roval pit range covers index 0 on the front stretch', () => {
    const pit = loadRoval().pit;
    expect(pit).toBeDefined();
    const { start, end } = pit;
    expect(Number.isInteger(start) && Number.isInteger(end), 'pit indices').toBe(true);
    const coversZero = start <= end ? start <= 0 && 0 <= end : 0 >= start || 0 <= end;
    expect(coversZero, `pit start=${start} end=${end}`).toBe(true);
  });

  it('EDGE5: menu TRACK_CHOICES renames fontana and inserts fontana-roval after it; ENV/FOG tables copy fontana values', () => {
    const fi = TRACK_CHOICES.findIndex((c) => c.id === 'fontana');
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(TRACK_CHOICES[fi].name).toBe('Fontana Interior');
    expect(TRACK_CHOICES[fi + 1]?.id).toBe('fontana-roval');
    expect(TRACK_CHOICES[fi + 1]?.name).toBe('Fontana Sports Car Course');
    expect(ENV_TABLE['fontana-roval']).toBe(ENV_TABLE['fontana']);
    expect(FOG_TABLE['fontana-roval']).toBeDefined();
    expect(FOG_TABLE['fontana-roval'].density).toBe(FOG_TABLE['fontana'].density);
  });

  it('EDGE6: public/tracks/fontana.json is byte-identical to the master file', () => {
    const bytes = readFileSync(join(ROOT, 'public', 'tracks', 'fontana.json'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe('649ce915af19f3658708f38970c2dc3b6abd1919c2b5ad55f9fbe412937973f1');
  });

  it('EDGE7: every index.json entry other than fontana/fontana-roval keeps its id, name, country and lengthKm', () => {
    const entries = readJson<Array<{ id: string; name: string; country: string; lengthKm: number }>>(
      'public/tracks/index.json',
    );
    const expected: Array<[string, string, string, number]> = [
      ['monza', 'Monza', 'Italy', 5.793],
      ['spa', 'Spa', 'Belgium', 7.004],
      ['silverstone', 'Silverstone', 'United Kingdom', 5.891],
      ['mexico', 'Mexico City', 'Mexico', 4.304],
      ['daytona', 'Daytona', 'United States', 5.729],
      ['lusail', 'Lusail', 'Qatar', 5.419],
      ['bahrain', 'Sakhir', 'Bahrain', 5.412],
      ['braselton', 'Braselton', 'United States', 4.088],
      ['elkhart', 'Elkhart Lake', 'United States', 6.515],
      ['sepang', 'Sepang', 'Malaysia', 5.543],
      ['baku', 'Baku', 'Azerbaijan', 6.003],
      ['budapest', 'Budapest', 'Hungary', 4.381],
      ['singapore', 'Singapore', 'Singapore', 4.94],
      ['lasvegas', 'Las Vegas', 'United States', 6.201],
      ['spielberg', 'Spielberg', 'Austria', 4.318],
      ['cleveland', 'Cleveland', 'United States', 3.426],
      ['detroit', 'Detroit', 'United States', 2.562],
    ];
    for (const [id, name, country, lengthKm] of expected) {
      const e = entries.find((x) => x.id === id);
      expect(e, `entry ${id}`).toBeDefined();
      expect(e?.name, `${id} name`).toBe(name);
      expect(e?.country, `${id} country`).toBe(country);
      expect(e?.lengthKm ?? Infinity, `${id} lengthKm`).toBeCloseTo(lengthKm, 6);
    }
    const fontana = entries.find((x) => x.id === 'fontana');
    expect(fontana?.country).toBe('United States');
    expect(fontana?.lengthKm ?? Infinity).toBeCloseTo(2.426, 6);
  });

  it('EDGE8: tracks.json fontana entry only changes its name to Fontana Interior', () => {
    const expected = {
      id: 'fontana',
      name: 'Fontana Interior',
      country: 'United States',
      geojson: 'us-fontana',
      source: {
        dataset: 'OpenStreetMap',
        license: 'ODbL 1.0',
        url: 'https://www.openstreetmap.org/copyright',
      },
      dem: 'assets/source/dem/fontana.json',
      maxGrade: 0.03,
      widthMeters: 15,
      environment: 'desert',
      reverse: false,
      biome: {
        species: [{ name: 'oak', weight: 1.0 }],
        density: 0.02,
      },
      grandstands: [
        { atMeters: 0, side: 'left', offsetMeters: 30, lengthMeters: 120, rows: 16, roof: true },
        { atMeters: 400, side: 'left', offsetMeters: 30, lengthMeters: 80, rows: 12, roof: false },
        { atMeters: 1900, side: 'left', offsetMeters: 30, lengthMeters: 80, rows: 10, roof: false },
      ],
      pit: { fromMeters: -300, toMeters: 300, side: 'right' },
    };
    expect(registryEntry('fontana')).toEqual(expected);
  });

  it('EDGE9: tracks.json fontana-roval copies fontana dem, maxGrade, widthMeters, environment, biome and source', () => {
    const roval = registryEntry('fontana-roval');
    const fontana = registryEntry('fontana');
    expect(roval.name).toBe('Fontana Sports Car Course');
    expect(roval.country).toBe('United States');
    expect(roval.geojson).toBe('us-fontana-roval');
    expect(roval.dem).toBe(fontana.dem);
    expect(roval.maxGrade).toBe(fontana.maxGrade);
    expect(roval.widthMeters).toBe(fontana.widthMeters);
    expect(roval.environment).toBe(fontana.environment);
    expect(roval.biome).toEqual(fontana.biome);
    expect(roval.source).toEqual(fontana.source);
  });

  it('EDGE10: the per-id ground texture public/textures/ground/fontana-roval.jpg exists', () => {
    expect(existsSync(join(ROOT, 'public', 'textures', 'ground', 'fontana-roval.jpg'))).toBe(true);
  });
});

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

// sha256 of every pre-existing public/tracks/*.json on master at test-writing time.
// index.json is excluded here: it gains the 6 entries, its unchanged part is AT2.
const MASTER_HASHES: Record<string, string> = {
  'bahrain.json': '1ac84b1117cb810b9666db011e1333877c92a2d8ebf2e186fee1f1cf99978371',
  'bahrain.style.json': 'ef217935d71fe5774b48b845dd3dae7cd82bb96df06f2c83d2add784acec5645',
  'baku-env.json': '38b9a37e60f941e887fe175791f604c36ce4d38a4a10e71475e64cc9372e8099',
  'baku.json': 'd95b9a60fff71c63585a20142952f690592c6cc9e66ccf586ca5d0255925633f',
  'baku.style.json': '4af365cbc2fd9d62d274853a94a2970a68ffa1101321f1fbab1d2c0a59840b27',
  'braselton.json': 'bd5a7ba0a01c71e47ef14d36826e351a6f813e9241399050515876a791f079bc',
  'braselton.style.json': '1f93dc666f4e852f14b9472b09f8124be32710476b6377a235e3733e3c2c523e',
  'budapest.json': 'baa4756e928958c6eaff19c58578378ef9d1a14e13ad4bd4f5a2d33ca8845350',
  'budapest.style.json': 'e64716fd9411f2ea77f9c25ce74a53fd264444be05458a128cf6bcb64a3cc336',
  'cleveland.json': '412f66295709d16106349c56d68ff94ae5dbae09a0c391d6c9e757bfec7f4d50',
  'cleveland.style.json': '43f2c819fdfbd7e2e2183a508ea7df34bf602d304a60cc10de7e70ed2258f967',
  'daytona.json': '5a7dd75b0f9ca9f2bbea161efa66cebaa3a43312665127ad1c9505fd3f7b3217',
  'daytona.style.json': '5047c1f4a1e01f2e19cc6c67be0b0922fc91b6078c825bbf53c4f022fbb56eb6',
  'detroit.json': '587de9985bd876fa17603c633aebb3408e8a250ec63093105ebd21993a97d16b',
  'detroit.style.json': '0f052d52743836b620825c2c36a7f93f8237b0ba7b0afdbcd1d83106c70d8ddc',
  'elkhart.json': '4ae7ca652ab8e62c058dec49b29ac00ba8842d418a21514b11d23e4ff687ebad',
  'elkhart.style.json': 'fbd45c076cd531eebf3be2ddc8ff97c4da954a7c4ede734c40097926965c37ba',
  'fontana-roval.json': '18e1269f2cdfe97e03837bc22f7cddd3bb8c9d7f2b0404ef2611f0a5ea03a574',
  'fontana.json': '26b619a9f2e3582d8787025a5db6c97e26e36976134f8b6af44dc83dbc3295fa',
  'fontana.style.json': '7e23763cf6aad97e39326fb8f791626ec82a75a5c7071a27cbc35989078615ba',
  'lasvegas-env.json': '626ec59afecbe38550053872269d6838381e46175a2734f16714c72f8f2f64ce',
  'lasvegas.json': '33482acf564d93a7df27dd6db310cad883cc59e11e4c344af1ec6cf4d9871a4e',
  'lasvegas.style.json': 'a1a84f3967ae29c6ab7b2006eae3a3e3af938bd3387c424b681a92c0d740233e',
  'lusail.json': '6c92afd076bc334e086f572be016e4fbba392e984b4a7ae060340cc0dc8c7ae8',
  'lusail.style.json': '152200e366f6af1ac17aa7db87f74ba6462f5978a7261b71967442c4ee03073f',
  'mexico.json': '73ee24c221135659dabfb735bd7c8f7f9d61080cda328b3ae8e629cd26cec243',
  'mexico.style.json': '99e125322dffadc2889be05c3fd39dfc737b2efbaa25ed09455379fa4b805cb0',
  'monza.json': 'c9c395f30372df560aa5cc03219f1e68ddc7835f929662ad76e69305bf23e843',
  'monza.style.json': '22ee66af5dc9e215802bdd43bdc02f98cea928b0d49cd356ee033087f455ab9c',
  'sepang.json': '96a94c6000276f3e231d2bc4564ea6b484f86263c1a10280823180639747b27b',
  'sepang.style.json': 'fa46aa49846c6ebfec068c3cda6d665b780e8043a271b21032a476dd5acfa231',
  'silverstone.json': '06a217e8a0dbb52f3888acc5d2f65357687739e085b89e2725e520a1bdff758a',
  'silverstone.style.json': '33235655e19b30f1536b668e5ca44173e4d82de168665fb90f0dc6070719e8e0',
  'singapore-env.json': '82ca9b70c48a5ccabfe14a02c2459ec33de01295d90be52a5ec7bd648de0fdc7',
  'singapore.json': 'b9ea673dc33ea70bea76816f4affe0178dbe6e33b9db195371e29d914dc4f644',
  'singapore.style.json': '053c9e6ddcb6ace084ec973993195321f0ac796def621f631c7ad8280b28bfbf',
  'spa.json': 'ab84e19f2cb2a291ca3d3e24ee209d6ddb53fd5dc2f9697977b960192b15a29c',
  'spa.style.json': '8cd6ad25ad82dba77425f9327677b2099adb9543edf74ca32a82369d2a021190',
  'spielberg.json': '33dec7af3d84709735a3e8f0a5416cb12d625ca0415609a0551db8157d209cd3',
  'spielberg.style.json': '4acb88eba030d2b2992c6535066f1f6fd77980ac795aa2557ab50f20b2c7c9b9',
};

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
    const preexisting = entries.filter((e) => !e.id.startsWith('ermita-'));
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

  it('AT4: every pre-existing public/tracks JSON other than index.json is byte-identical to master', () => {
    for (const [file, hash] of Object.entries(MASTER_HASHES)) {
      if (file.endsWith('.style.json')) continue;
      const path = join(ROOT, 'public', 'tracks', file);
      expect(existsSync(path), `${file}: exists`).toBe(true);
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
      expect(actual, file).toBe(hash);
    }
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

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
  'bahrain.json': '09a79f7d0ff96eb6add72804579786462dee7c4a890d5162025c029cbe7e0333',
  'bahrain.style.json': 'ef217935d71fe5774b48b845dd3dae7cd82bb96df06f2c83d2add784acec5645',
  'baku-env.json': '38b9a37e60f941e887fe175791f604c36ce4d38a4a10e71475e64cc9372e8099',
  'baku.json': '6de8d5b1655999f18ed2bb4bd4bf075bc9bdd245266b070a4b755a09ac70a091',
  'baku.style.json': '4af365cbc2fd9d62d274853a94a2970a68ffa1101321f1fbab1d2c0a59840b27',
  'braselton.json': 'f3c6bb28fb703ce4643182539ecd69d2133f61f94ae5ef4ba67c18b6a0e741ff',
  'braselton.style.json': '1f93dc666f4e852f14b9472b09f8124be32710476b6377a235e3733e3c2c523e',
  'budapest.json': '789b34d8fb219fd3ac2c24d651e91754aa8fe9c3e2a159d5d68d943a2ff06ec4',
  'budapest.style.json': 'e64716fd9411f2ea77f9c25ce74a53fd264444be05458a128cf6bcb64a3cc336',
  'cleveland.json': '94f17392f41b032169600862b4f8796c2f53b25b5c0ccc377cda3f103142261d',
  'cleveland.style.json': '43f2c819fdfbd7e2e2183a508ea7df34bf602d304a60cc10de7e70ed2258f967',
  'daytona.json': 'b9c5fe0dcdd2ce6250241c5a8c5c41257bb43123150d919d6233e125586198aa',
  'daytona.style.json': '5047c1f4a1e01f2e19cc6c67be0b0922fc91b6078c825bbf53c4f022fbb56eb6',
  'detroit.json': '96946dde9acdc792322f8502f0c10412ac71b779c7ed131af2099f69a8cbe263',
  'detroit.style.json': '0f052d52743836b620825c2c36a7f93f8237b0ba7b0afdbcd1d83106c70d8ddc',
  'elkhart.json': 'f0ea322690ea2bdcdfee6285f976e4e4bc0185ec3160b2c3b633921c5f6e6a7b',
  'elkhart.style.json': 'fbd45c076cd531eebf3be2ddc8ff97c4da954a7c4ede734c40097926965c37ba',
  'fontana-roval.json': 'f800272d0af97aa9c710306adcec38f659320cfba4462d5a2edba439d52a6a1f',
  'fontana.json': '6af89f7b062758d9ae2e37b50d85be98fbabed961debc36cdbeff862c49c27a6',
  'fontana.style.json': '7e23763cf6aad97e39326fb8f791626ec82a75a5c7071a27cbc35989078615ba',
  'lasvegas-env.json': '626ec59afecbe38550053872269d6838381e46175a2734f16714c72f8f2f64ce',
  'lasvegas.json': '3cf1444ceb51b5793e806c07687d7da9140aa8999339e0cf5083e924c5cbbe45',
  'lasvegas.style.json': 'a1a84f3967ae29c6ab7b2006eae3a3e3af938bd3387c424b681a92c0d740233e',
  'lusail.json': 'e102b65dd2295f9e9d408a19bc06e27fe3068acd5ca33211d74d7447628c7feb',
  'lusail.style.json': '152200e366f6af1ac17aa7db87f74ba6462f5978a7261b71967442c4ee03073f',
  'mexico.json': '44078c807113837d7ae43b359551052b39a2f96c286657c6d7d9088666f1292f',
  'mexico.style.json': '99e125322dffadc2889be05c3fd39dfc737b2efbaa25ed09455379fa4b805cb0',
  'monza.json': 'fbf273ecfd1589a742729f6ce029a4426b3ddcca2537c9587756e898cdcb0126',
  'monza.style.json': '22ee66af5dc9e215802bdd43bdc02f98cea928b0d49cd356ee033087f455ab9c',
  'sepang.json': '75803ca5fc82489fd3f97d001a2e9d8e55394a87b4c1eadafcc10d168c96f702',
  'sepang.style.json': 'fa46aa49846c6ebfec068c3cda6d665b780e8043a271b21032a476dd5acfa231',
  'silverstone.json': 'faa23fbe4e90dd9c0e3ee71305c1f8cc59fda01c89240c3045d26cde29f2aec5',
  'silverstone.style.json': '33235655e19b30f1536b668e5ca44173e4d82de168665fb90f0dc6070719e8e0',
  'singapore-env.json': '82ca9b70c48a5ccabfe14a02c2459ec33de01295d90be52a5ec7bd648de0fdc7',
  'singapore.json': '834cdb814a3093d3d4adc776b518b78f2c055b1be6b21e62c6094e5e21891b88',
  'singapore.style.json': '053c9e6ddcb6ace084ec973993195321f0ac796def621f631c7ad8280b28bfbf',
  'spa.json': '3de0ffed0cfd54d90db2c43113a0fc62f020172da0f467e080e34a590faa58fd',
  'spa.style.json': '8cd6ad25ad82dba77425f9327677b2099adb9543edf74ca32a82369d2a021190',
  'spielberg.json': '9d8fcde62133c7a8b62225c57cfb435eb410e0f183aace46a8808124a4439a2a',
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

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { layoutBarriers as layoutBarriersCurrent } from '../../../tools/track-builder/barriers';
import type {
  BarrierSegment,
  EnvironmentType,
  PitLane,
  RunoffSegment,
  TrackDataV2,
  TrackSegment,
} from '../../../src/core/types';
import type { Point2 as Point2T } from '../../../src/track/geo';

// Future signature per the planner decision: optional `walls` after `environment`.
const layoutBarriers = layoutBarriersCurrent as unknown as (
  centerline: Point2T[],
  widthMeters: number,
  kerbs: TrackSegment[],
  runoffs: RunoffSegment[],
  pit?: PitLane,
  environment?: EnvironmentType,
  walls?: boolean,
) => BarrierSegment[];
import {
  bboxCenter,
  polylineLength,
  unprojectXZ,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { ENV_TABLE, FOG_TABLE } from '../../../src/render/environment';
import { TRACK_CONDITIONS } from '../../../src/track/trackConditions';

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

const PIT: Record<string, { fromMeters: number; toMeters: number; side: 'left' | 'right' }> = {
  'ermita-centro': { fromMeters: 0, toMeters: 150, side: 'left' },
  'ermita-federal': { fromMeters: -300, toMeters: 250, side: 'right' },
  'ermita-norte': { fromMeters: -200, toMeters: 250, side: 'left' },
  'ermita-mixto': { fromMeters: -130, toMeters: 200, side: 'left' },
  'ermita-poniente': { fromMeters: -110, toMeters: 150, side: 'right' },
  'ermita-veloz': { fromMeters: -150, toMeters: 250, side: 'left' },
};

const STANDS: Record<string, Array<{ atMeters: number; side: 'left' | 'right' }>> = {
  'ermita-centro': [{ atMeters: -45, side: 'left' }],
  'ermita-federal': [
    { atMeters: 0, side: 'left' },
    { atMeters: 540, side: 'left' },
    { atMeters: -645, side: 'left' },
  ],
  'ermita-norte': [
    { atMeters: -150, side: 'right' },
    { atMeters: -1455, side: 'left' },
    { atMeters: -1950, side: 'right' },
  ],
  'ermita-mixto': [
    { atMeters: 0, side: 'right' },
    { atMeters: 1215, side: 'right' },
    { atMeters: 675, side: 'left' },
  ],
  'ermita-poniente': [
    { atMeters: 1350, side: 'right' },
    { atMeters: 135, side: 'right' },
  ],
  'ermita-veloz': [
    { atMeters: 135, side: 'right' },
    { atMeters: 585, side: 'left' },
    { atMeters: 1035, side: 'left' },
  ],
};

const STAND_LATERAL_M = 12 / 2 + 30;

const SOURCE_HASHES: Record<string, string> = {
  'assets/source/tracks/mx-ermita-centro.geojson': '31a909a69ba7390745cd6bf1dac748a12cda30aa6a9da8bcd3bf3931ec79fcbd',
  'assets/source/tracks/mx-ermita-federal.geojson': 'febd75441a12c767326c5ceab591c9fd293f6693dd3edb101ed14bf8b031b52a',
  'assets/source/tracks/mx-ermita-norte.geojson': '117b76bf8fcc82be0cb61de7b692a309eae9f7970fe03745e366b560498a1af3',
  'assets/source/tracks/mx-ermita-mixto.geojson': '8c59fd3d2cb56e40172181c73be759a59901f19514f866d77d3176202b952a00',
  'assets/source/tracks/mx-ermita-poniente.geojson': 'ea392d2a5c40c03a5ffc116140befbf00c9d4800d62db98cd74e2e626e967bfe',
  'assets/source/tracks/mx-ermita-veloz.geojson': 'e2f2c97139abcb40a0be02adcd32215a6a5d67c236c6db546d841226656b88af',
  'assets/source/ground/ermita-s2.jpg': 'e041fed0236488d01e61a0060bb1b3806d671dafc6a86cad92d68bdb7a7ed76a',
  'assets/source/ground/ermita-s2.json': '9fe2d3473101ec2c9d4b8f833190ba38d889e493295099c46004ea22d97f4116',
  'assets/source/dem/ermita.json': 'dca65f0d9567696360a079fcf167bca7948e07155be575e88bc14a191b1f8e3d',
};

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
  reverse: boolean;
  biome: unknown;
  walls?: boolean;
  banking?: unknown;
  pit?: { fromMeters: number; toMeters: number; side: string };
  grandstands?: Array<{ atMeters: number; side: string; offsetMeters: number; lengthMeters: number; rows: number; roof: boolean }>;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

function registry(): RegistryEntry[] {
  return readJson<RegistryEntry[]>('tools/track-builder/tracks.json');
}

function registryEntry(id: string): RegistryEntry {
  const found = registry().find((e) => e.id === id);
  if (!found) throw new Error(`tracks.json: missing ${id}`);
  return found;
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson<unknown>(`public/tracks/${id}.json`)) as TrackDataV2;
}

function sourceCoords(id: string): LonLat[] {
  const geo = readJson<{ features: { geometry: { coordinates: LonLat[] } }[] }>(
    `assets/source/tracks/mx-${id}.geojson`,
  );
  const coords = geo.features[0]?.geometry.coordinates;
  if (!coords || coords.length === 0) throw new Error(`mx-${id}.geojson: no coordinates`);
  return coords;
}

// Same wrap/scan as the builder's indexAtMeters.
function indexAtMeters(centerline: Point2[], meters: number): number {
  const lap = polylineLength(centerline, true);
  const target = ((meters % lap) + lap) % lap;
  let cum = 0;
  for (let i = 0; i < centerline.length; i++) {
    if (i > 0) {
      cum += Math.hypot(
        centerline[i][0] - centerline[i - 1][0],
        centerline[i][1] - centerline[i - 1][1],
      );
    }
    if (cum >= target) return i;
  }
  return centerline.length - 1;
}

function circle(radius: number, n: number): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

function bilinear(buf: Buffer, w: number, h: number, cx: number, cy: number): [number, number, number] {
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const fx = cx - x0;
  const fy = cy - y0;
  const clamp = (v: number, m: number) => Math.max(0, Math.min(m, v));
  const acc: [number, number, number] = [0, 0, 0];
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const px = clamp(x0 + dx, w - 1);
      const py = clamp(y0 + dy, h - 1);
      const wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const o = (py * w + px) * 3;
      acc[0] += buf[o] * wgt;
      acc[1] += buf[o + 1] * wgt;
      acc[2] += buf[o + 2] * wgt;
    }
  }
  return acc;
}

function softShoulder(x: number): number {
  return x <= 200 ? x : 200 + 45 * Math.tanh((x - 200) / 45);
}

describe('241 ermita tracks edge cases', () => {
  it('EDGE1: tracks.json appends the 6 ermita entries after detroit with the common fields and walls true', () => {
    const entries = registry();
    const di = entries.findIndex((e) => e.id === 'detroit');
    expect(di).toBeGreaterThanOrEqual(0);
    const block = entries.slice(di + 1, di + 1 + IDS.length);
    expect(block.map((e) => e.id)).toEqual([...IDS]);
    expect(block.map((e) => e.name)).toEqual([...NAMES]);
    for (let k = 0; k < IDS.length; k++) {
      const e = block[k];
      const id = IDS[k];
      expect(e.country, `${id}: country`).toBe('Mexico');
      expect(e.geojson, `${id}: geojson`).toBe(`mx-${id}`);
      expect(e.dem, `${id}: dem`).toBe('assets/source/dem/ermita.json');
      expect(e.maxGrade, `${id}: maxGrade`).toBe(0.03);
      expect(e.widthMeters, `${id}: widthMeters`).toBe(12);
      expect(e.environment, `${id}: environment`).toBe('desert');
      expect(e.reverse, `${id}: reverse`).toBe(false);
      expect(e.walls, `${id}: walls`).toBe(true);
      expect(e.banking, `${id}: no banking`).toBeUndefined();
      expect(e.source, `${id}: source`).toEqual({
        dataset: 'OpenStreetMap',
        license: 'ODbL 1.0',
        url: 'https://www.openstreetmap.org/copyright',
      });
      expect(e.biome, `${id}: biome`).toEqual({
        species: [
          { name: 'shrub-dry', weight: 0.6 },
          { name: 'palm-date', weight: 0.3 },
          { name: 'cactus', weight: 0.1 },
        ],
        density: 0.04,
      });
    }
  });

  it('EDGE2: tracks.json pit windows match the mx-ermita.md table per layout', () => {
    for (const id of IDS) {
      expect(registryEntry(id).pit, id).toEqual(PIT[id]);
    }
  });

  it('EDGE3: tracks.json grandstands match the mx-ermita.md table per layout with offset 30, length 70, rows 10, no roof', () => {
    for (const id of IDS) {
      const expected = STANDS[id].map((s) => ({
        atMeters: s.atMeters,
        side: s.side,
        offsetMeters: 30,
        lengthMeters: 70,
        rows: 10,
        roof: false,
      }));
      expect(registryEntry(id).grandstands, id).toEqual(expected);
    }
  });

  it('EDGE4: layoutBarriers with walls forces wall type without changing offsets, and the built ermita barriers are wall/foam covering the full lap on both sides', () => {
    const pts = circle(80, 64);
    const withFlag = layoutBarriers(pts, 12, [], [], undefined, 'desert', true);
    const withoutFlag = layoutBarriers(pts, 12, [], [], undefined, 'desert');
    expect(withFlag.every((b) => b.type === 'wall')).toBe(true);
    expect(withoutFlag.every((b) => b.type === 'armco')).toBe(true);
    expect(withFlag.map((b) => b.offsetMeters)).toEqual(withoutFlag.map((b) => b.offsetMeters));

    for (const id of IDS) {
      const track = loadTrack(id);
      const n = track.centerline.length;
      expect(track.barriers.length, `${id}: barriers present`).toBeGreaterThan(0);
      const spans = track.bridges ?? [];
      for (const b of track.barriers) {
        // Task 243: bridge spans carry armco guardrails; outside spans wall/foam only.
        const onBridge =
          b.type === 'armco' &&
          b.start <= b.end &&
          spans.some((s) => b.start >= s.from && b.end <= s.to);
        if (onBridge) continue;
        expect(['wall', 'foam'], `${id}: barrier type`).toContain(b.type);
      }
      for (const side of ['left', 'right'] as const) {
        const covered = new Array<boolean>(n).fill(false);
        for (const b of track.barriers) {
          if (b.side !== side) continue;
          let i = b.start;
          for (;;) {
            covered[i] = true;
            if (i === b.end) break;
            i = (i + 1) % n;
          }
        }
        expect(covered.every(Boolean), `${id}: ${side} fully walled`).toBe(true);
      }
    }
  });

  it('EDGE5: every built ermita elevation segment respects maxGrade 0.03', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      const e = track.elevation;
      const c = track.centerline;
      expect(e.length).toBe(c.length);
      for (let i = 0; i < c.length; i++) {
        const j = (i + 1) % c.length;
        const run = Math.hypot(c[j][0] - c[i][0], c[j][1] - c[i][1]);
        if (run === 0) continue;
        expect(Math.abs(e[j] - e[i]) / run, `${id}: grade at ${i}`).toBeLessThanOrEqual(0.03 + 1e-9);
      }
    }
  });

  it('EDGE6: every built grandstand sits 36 m laterally on the table side at the table arc position with length 70, rows 10, no roof', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      expect(track.grandstands.length, `${id}: stand count`).toBe(STANDS[id].length);
      for (let k = 0; k < STANDS[id].length; k++) {
        const spec = STANDS[id][k];
        const g = track.grandstands[k];
        const i = indexAtMeters(track.centerline, spec.atMeters);
        const [px, pz] = track.centerline[i];
        const [nx, nz] = track.centerline[(i + 1) % track.centerline.length];
        const dx = nx - px;
        const dz = nz - pz;
        const vx = g.x - px;
        const vz = g.z - pz;
        expect(Math.hypot(vx, vz), `${id} stand ${k}: lateral`).toBeCloseTo(STAND_LATERAL_M, 5);
        const cross = dx * vz - dz * vx;
        if (spec.side === 'right') {
          expect(cross, `${id} stand ${k}: right side`).toBeGreaterThan(0);
        } else {
          expect(cross, `${id} stand ${k}: left side`).toBeLessThan(0);
        }
        expect(g.lengthMeters, `${id} stand ${k}: length`).toBe(70);
        expect(g.rows, `${id} stand ${k}: rows`).toBe(10);
        expect(g.roof, `${id} stand ${k}: roof`).toBe(false);
      }
    }
  });

  it('EDGE7: the 6 ermita ids have track conditions 1.2/40, sky qwantani_noon_puresky and fog density 0.0004', () => {
    for (const id of IDS) {
      expect(TRACK_CONDITIONS[id], `${id}: conditions`).toEqual({ abrasion: 1.2, trackTempC: 40 });
      expect(ENV_TABLE[id], `${id}: env`).toBe('qwantani_noon_puresky');
      expect(FOG_TABLE[id]?.density, `${id}: fog`).toBe(0.0004);
    }
  });

  it('EDGE8: each ground crop matches the Sentinel-2 scene along the centerline and obeys the tone rules', async () => {
    const sidecar = readJson<{
      bounds: { lonMin: number; latMin: number; lonMax: number; latMax: number };
      widthPx: number;
      heightPx: number;
    }>('assets/source/ground/ermita-s2.json');
    const { lonMin, latMin, lonMax, latMax } = sidecar.bounds;
    const srcMeta = await sharp(join(ROOT, 'assets/source/ground/ermita-s2.jpg')).metadata();
    const srcW = srcMeta.width ?? sidecar.widthPx;
    const srcH = srcMeta.height ?? sidecar.heightPx;
    const src = await sharp(join(ROOT, 'assets/source/ground/ermita-s2.jpg')).raw().toBuffer();

    for (const id of IDS) {
      const cropPath = join(ROOT, 'public/textures/ground', `${id}.jpg`);
      expect(existsSync(cropPath), `${id}: crop exists`).toBe(true);
      const meta = await sharp(cropPath).metadata();
      expect(meta.width, `${id}: width`).toBe(2048);
      expect(meta.height, `${id}: height`).toBe(2048);
      const crop = await sharp(cropPath).raw().toBuffer();

      const track = loadTrack(id);
      const { originX, originZ, sizeX, sizeZ } = track.terrain;
      const origin = bboxCenter(sourceCoords(id));
      for (const frac of [0.25, 0.5, 0.75]) {
        const [x, z] = track.centerline[Math.floor(track.centerline.length * frac)];
        const u = ((x - (originX - sizeX / 2)) / sizeX) * 2048 - 0.5;
        const v = ((z - (originZ - sizeZ / 2)) / sizeZ) * 2048 - 0.5;
        const ix = Math.max(0, Math.min(2047, Math.round(u)));
        const iy = Math.max(0, Math.min(2047, Math.round(v)));
        const o = (iy * 2048 + ix) * 3;
        const actual: [number, number, number] = [crop[o], crop[o + 1], crop[o + 2]];
        const [lon, lat] = unprojectXZ([x, z], origin);
        const lonN = (lon - lonMin) / (lonMax - lonMin);
        const latN = (latMax - lat) / (latMax - latMin);
        let best = Infinity;
        for (const cf of [lonN * srcW - 0.5, lonN * (srcW - 1)]) {
          for (const rf of [latN * srcH - 0.5, latN * (srcH - 1)]) {
            const expected = bilinear(src, srcW, srcH, cf, rf).map(softShoulder);
            const diff = Math.max(
              Math.abs(actual[0] - expected[0]),
              Math.abs(actual[1] - expected[1]),
              Math.abs(actual[2] - expected[2]),
            );
            best = Math.min(best, diff);
          }
        }
        expect(best, `${id}: crop vs scene at frac ${frac}`).toBeLessThanOrEqual(25);
      }

      const hist = new Array<number>(256).fill(0);
      for (let i = 0; i < crop.length; i += 3) {
        hist[Math.max(crop[i], crop[i + 1], crop[i + 2])] += 1;
      }
      const total = crop.length / 3;
      let cum = 0;
      let p99 = 255;
      for (let v = 0; v < 256; v++) {
        cum += hist[v];
        if (cum >= 0.99 * total) {
          p99 = v;
          break;
        }
      }
      expect(p99, `${id}: p99`).toBeLessThanOrEqual(236);
    }
  }, 60000);

  it('EDGE9: package.json exposes build:ground and the cropGround CLI rejects an unknown track id', () => {
    const pkg = readJson<{ scripts: Record<string, string> }>('package.json');
    expect(pkg.scripts['build:ground']).toBe('tsx tools/ground/cropGround.ts');
    expect(existsSync(join(ROOT, 'tools/ground/cropGround.ts'))).toBe(true);
    let status = 0;
    try {
      execFileSync('npx', ['tsx', 'tools/ground/cropGround.ts', 'ermita-nope'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch (e) {
      status = (e as { status?: number }).status ?? 1;
    }
    expect(status).toBeGreaterThan(0);
  }, 120000);

  it('EDGE10: the ermita source assets stay byte-identical to master and fetchDem.ts gains no ermita ids', () => {
    for (const [file, hash] of Object.entries(SOURCE_HASHES)) {
      const actual = createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex');
      expect(actual, file).toBe(hash);
    }
    const fetchDem = readFileSync(join(ROOT, 'tools/dem/fetchDem.ts'), 'utf8');
    for (const id of IDS) {
      expect(fetchDem.includes(id), `fetchDem.ts must not mention ${id}`).toBe(false);
    }
  });
});

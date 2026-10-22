import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { layoutBarriers as layoutBarriersCurrent } from '../../../tools/track-builder/barriers';
import type {
  BarrierSegment,
  EnvironmentType,
  PitLane,
  RunoffSegment,
} from '../../../src/core/types';
import {
  bboxCenter,
  polylineLength,
  unprojectXZ,
  type LonLat,
  type Point2,
} from '../../../src/track/geo';
import { TRACK_CHOICES } from '../../../src/ui/menu';

// Future signature per the planner decision: optional `walls` after `environment`.
const layoutBarriers = layoutBarriersCurrent as unknown as (
  centerline: Point2[],
  widthMeters: number,
  kerbs: never[],
  runoffs: RunoffSegment[],
  pit?: PitLane,
  environment?: EnvironmentType,
  walls?: boolean,
) => BarrierSegment[];

const ROOT = join(__dirname, '..', '..', '..');
const IDS = [
  'ermita-centro',
  'ermita-federal',
  'ermita-norte',
  'ermita-mixto',
  'ermita-poniente',
  'ermita-veloz',
] as const;

const PIT: Record<string, { fromMeters: number; toMeters: number; side: 'left' | 'right' }> = {
  'ermita-centro': { fromMeters: 0, toMeters: 150, side: 'left' },
  'ermita-federal': { fromMeters: -300, toMeters: 250, side: 'right' },
  'ermita-norte': { fromMeters: -200, toMeters: 250, side: 'left' },
  'ermita-mixto': { fromMeters: -130, toMeters: 200, side: 'left' },
  'ermita-poniente': { fromMeters: -110, toMeters: 150, side: 'right' },
  'ermita-veloz': { fromMeters: -150, toMeters: 250, side: 'left' },
};

// sha256 of JSON.stringify of the 19 pre-existing tracks.json entries on master.
const MASTER_REGISTRY_SHA =
  '1183dd4050435f744e158ab44e3649402f2a30eb7dc9246fbcb3596069e3357e';

interface RegistryEntry {
  id: string;
  name: string;
  geojson: string;
}

interface IndexRow {
  id: string;
  lengthKm: number;
  outline: number[][];
}

interface TrackJson {
  officialLengthMeters?: number;
  centerline: Point2[];
  pit: { start: number; end: number; side: string };
  terrain: { originX: number; originZ: number; sizeX: number; sizeZ: number; rows: number; cols: number; heights: number[] };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
}

function rawTrack(id: string): TrackJson {
  return readJson<TrackJson>(`public/tracks/${id}.json`);
}

function sourceCoords(id: string): LonLat[] {
  const geo = readJson<{ features: { geometry: { coordinates: LonLat[] } }[] }>(
    `assets/source/tracks/mx-${id}.geojson`,
  );
  const coords = geo.features[0]?.geometry.coordinates;
  if (!coords || coords.length === 0) throw new Error(`mx-${id}.geojson: no coordinates`);
  return coords;
}

function circle(radius: number, n: number): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

function typeAt(segments: BarrierSegment[], side: 'left' | 'right', i: number): string | undefined {
  return segments.find((s) => s.side === side && i >= s.start && i <= s.end)?.type;
}

function offsetAt(segments: BarrierSegment[], side: 'left' | 'right', i: number): number | undefined {
  return segments.find((s) => s.side === side && i >= s.start && i <= s.end)?.offsetMeters;
}

function pathLength(centerline: Point2[], start: number, end: number): number {
  let L = 0;
  let i = start;
  while (i !== end) {
    const j = (i + 1) % centerline.length;
    L += Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
    i = j;
  }
  return L;
}

function softShoulder(x: number): number {
  return x <= 200 ? x : 200 + 45 * Math.tanh((x - 200) / 45);
}

function bilinearAt(buf: Buffer, w: number, h: number, stride: number, cx: number, cy: number): [number, number, number] {
  const cl = (v: number, m: number) => Math.max(0, Math.min(m, v));
  const x0 = Math.floor(cl(cx, w - 1));
  const y0 = Math.floor(cl(cy, h - 1));
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = cl(cx, w - 1) - x0;
  const ty = cl(cy, h - 1) - y0;
  const acc: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p00 = buf[(y0 * w + x0) * stride + c];
    const p10 = buf[(y0 * w + x1) * stride + c];
    const p01 = buf[(y1 * w + x0) * stride + c];
    const p11 = buf[(y1 * w + x1) * stride + c];
    const top = p00 + (p10 - p00) * tx;
    const bottom = p01 + (p11 - p01) * tx;
    acc[c] = top + (bottom - top) * ty;
  }
  return acc;
}

describe('241 ermita tracks post-code gaps', () => {
  it('GAPS1: the 6 ermita entries are the last entries of tracks.json, index.json and TRACK_CHOICES', () => {
    const registry = readJson<RegistryEntry[]>('tools/track-builder/tracks.json');
    expect(registry.length).toBe(28);
    expect(registry.slice(-(IDS.length + 3), -3).map((e) => e.id)).toEqual([...IDS]);
    const index = readJson<IndexRow[]>('public/tracks/index.json');
    expect(index.length).toBe(28);
    expect(index.slice(-(IDS.length + 3), -3).map((e) => e.id)).toEqual([...IDS]);
    expect(TRACK_CHOICES.length).toBe(28);
    expect(TRACK_CHOICES.slice(-(IDS.length + 3), -3).map((c) => c.id)).toEqual([...IDS]);
  });

  it('GAPS2: every non-ermita tracks.json entry is unchanged from master', () => {
    const registry = readJson<RegistryEntry[]>('tools/track-builder/tracks.json');
    const non = registry.filter((e) => !e.id.startsWith('ermita-') && !['bathurst', 'jeddah', 'miami'].includes(e.id));
    expect(non.length).toBe(19);
    expect(createHash('sha256').update(JSON.stringify(non)).digest('hex')).toBe(MASTER_REGISTRY_SHA);
  });

  it('GAPS3: layoutBarriers keeps the city/pit wall branches and walls overrides tyres', () => {
    const pts = circle(80, 64);
    const gravel: RunoffSegment[] = [
      { start: 10, end: 20, side: 'left', surface: 'gravel', widthMeters: 8 },
    ];
    const pit: PitLane = { start: 5, end: 15, side: 'right' };

    const city = layoutBarriers(pts, 12, [], [], undefined, 'city');
    expect(city.every((b) => b.type === 'wall')).toBe(true);

    const withPit = layoutBarriers(pts, 12, [], [], pit, 'desert');
    expect(typeAt(withPit, 'right', 10)).toBe('wall');
    expect(typeAt(withPit, 'right', 40)).toBe('armco');
    expect(typeAt(withPit, 'left', 40)).toBe('armco');

    const tyres = layoutBarriers(pts, 12, [], gravel, undefined, 'desert');
    expect(typeAt(tyres, 'left', 15)).toBe('tyres');
    expect(typeAt(tyres, 'left', 40)).toBe('armco');
    expect(typeAt(tyres, 'right', 15)).toBe('armco');

    const gravelWalls = layoutBarriers(pts, 12, [], gravel, undefined, 'desert', true);
    expect(typeAt(gravelWalls, 'left', 15)).toBe('wall');
    expect(typeAt(gravelWalls, 'left', 40)).toBe('wall');
    for (const side of ['left', 'right'] as const) {
      for (let i = 0; i < pts.length; i++) {
        expect(typeAt(gravelWalls, side, i), `${side} ${i}`).toBeDefined();
        expect(offsetAt(gravelWalls, side, i), `${side} ${i} offset`).toBe(offsetAt(tyres, side, i));
      }
    }

    const wallsFalse = layoutBarriers(pts, 12, [], gravel, undefined, 'desert', false);
    expect(wallsFalse.map((b) => b.type)).toEqual(tyres.map((b) => b.type));
  });

  it('GAPS4: crop pixels whose grid falls outside the Sentinel-2 scene clamp to the scene edge', async () => {
    const sidecar = readJson<{
      bounds: { lonMin: number; latMin: number; lonMax: number; latMax: number };
      widthPx: number;
      heightPx: number;
    }>('assets/source/ground/ermita-s2.json');
    const { lonMin, latMin, lonMax, latMax } = sidecar.bounds;
    const sceneMeta = await sharp(join(ROOT, 'assets/source/ground/ermita-s2.jpg')).metadata();
    const srcW = sceneMeta.width ?? sidecar.widthPx;
    const srcH = sceneMeta.height ?? sidecar.heightPx;
    const src = await sharp(join(ROOT, 'assets/source/ground/ermita-s2.jpg')).raw().toBuffer();
    const stride = src.length / (srcW * srcH);

    const ROWS = [0, 1, 5, 64, 512, 1024, 1536, 2000, 2043, 2047];
    const COLS = [0, 1, 5, 64, 512, 1024, 1536, 2000, 2043, 2047];
    const outOfScene = new Map<string, Array<{ u: number; v: number }>>();

    for (const id of IDS) {
      const { originX, originZ, sizeX, sizeZ } = rawTrack(id).terrain;
      const origin = bboxCenter(sourceCoords(id));
      const hits: Array<{ u: number; v: number }> = [];
      for (const v of ROWS) {
        const z = originZ - sizeZ / 2 + ((v + 0.5) / 2048) * sizeZ;
        const lat = unprojectXZ([0, z], origin)[1];
        const fy = ((latMax - lat) / (latMax - latMin)) * srcH - 0.5;
        for (const u of COLS) {
          const x = originX - sizeX / 2 + ((u + 0.5) / 2048) * sizeX;
          const lon = unprojectXZ([x, 0], origin)[0];
          const fx = ((lon - lonMin) / (lonMax - lonMin)) * srcW - 0.5;
          if (fx < 0 || fx > srcW - 1 || fy < 0 || fy > srcH - 1) hits.push({ u, v });
        }
      }
      if (hits.length === 0) continue;
      outOfScene.set(id, hits);

      const crop = await sharp(join(ROOT, 'public/textures/ground', `${id}.jpg`)).raw().toBuffer();
      for (const { u, v } of hits) {
        const z = originZ - sizeZ / 2 + ((v + 0.5) / 2048) * sizeZ;
        const lat = unprojectXZ([0, z], origin)[1];
        const fy = ((latMax - lat) / (latMax - latMin)) * srcH - 0.5;
        const x = originX - sizeX / 2 + ((u + 0.5) / 2048) * sizeX;
        const lon = unprojectXZ([x, 0], origin)[0];
        const fx = ((lon - lonMin) / (lonMax - lonMin)) * srcW - 0.5;
        const expected = bilinearAt(src, srcW, srcH, stride, fx, fy).map((c) =>
          Math.max(0, Math.min(255, Math.round(softShoulder(c)))),
        );
        const o = (v * 2048 + u) * 3;
        const diff = Math.max(
          Math.abs(crop[o] - expected[0]),
          Math.abs(crop[o + 1] - expected[1]),
          Math.abs(crop[o + 2] - expected[2]),
        );
        expect(diff, `${id}: pixel (${u}, ${v}) vs clamped scene edge`).toBeLessThanOrEqual(25);
      }
    }

    expect(outOfScene.get('ermita-norte')?.length ?? 0, 'norte has out-of-scene samples').toBeGreaterThan(0);
    expect(outOfScene.get('ermita-veloz')?.length ?? 0, 'veloz has out-of-scene samples').toBeGreaterThan(0);
  }, 60000);

  it('GAPS5: the cropGround CLI rejects an empty id list with a usage message', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync('npx', ['tsx', 'tools/ground/cropGround.ts'], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      status = err.status ?? 1;
      stderr = String(err.stderr ?? '');
    }
    expect(status).toBeGreaterThan(0);
    expect(stderr).toContain('usage:');
  }, 120000);

  it('GAPS6: each index.json ermita row matches its built track length and has a usable outline', () => {
    const index = readJson<IndexRow[]>('public/tracks/index.json');
    for (const id of IDS) {
      const row = index.find((e) => e.id === id);
      expect(row, `${id}: index row`).toBeDefined();
      const official = rawTrack(id).officialLengthMeters;
      expect(typeof official, `${id}: officialLengthMeters`).toBe('number');
      expect(Math.abs((row as IndexRow).lengthKm * 1000 - (official as number)), `${id}: lengthKm`).toBeLessThanOrEqual(0.5);
      const outline = (row as IndexRow).outline;
      expect(outline.length, `${id}: outline points`).toBeGreaterThanOrEqual(8);
      for (const [ox, oy] of outline) {
        expect(ox, `${id}: outline x`).toBeGreaterThanOrEqual(0);
        expect(ox, `${id}: outline x`).toBeLessThanOrEqual(1);
        expect(oy, `${id}: outline y`).toBeGreaterThanOrEqual(0);
        expect(oy, `${id}: outline y`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('GAPS7: each terrain grid covers the whole centerline with a consistent cell layout', () => {
    for (const id of IDS) {
      const t = rawTrack(id);
      const { originX, originZ, sizeX, sizeZ, rows, cols, heights } = t.terrain;
      expect(sizeX, `${id}: sizeX > 0`).toBeGreaterThan(0);
      expect(sizeZ, `${id}: sizeZ > 0`).toBeGreaterThan(0);
      expect(heights.length, `${id}: heights`).toBe((rows + 1) * (cols + 1));
      for (const [x, z] of t.centerline) {
        expect(x, `${id}: centerline x inside terrain`).toBeGreaterThanOrEqual(originX - sizeX / 2 - 1e-6);
        expect(x, `${id}: centerline x inside terrain`).toBeLessThanOrEqual(originX + sizeX / 2 + 1e-6);
        expect(z, `${id}: centerline z inside terrain`).toBeGreaterThanOrEqual(originZ - sizeZ / 2 - 1e-6);
        expect(z, `${id}: centerline z inside terrain`).toBeLessThanOrEqual(originZ + sizeZ / 2 + 1e-6);
      }
      expect(t.centerline.length).toBeGreaterThan(0);
      expect(polylineLength(t.centerline, true)).toBeGreaterThan(2400);
    }
  });

  it('GAPS8: each built pit window keeps the table side and stays within the table budget and the 120 m minimum', () => {
    for (const id of IDS) {
      const t = rawTrack(id);
      const spec = PIT[id];
      expect(t.pit.side, `${id}: pit side`).toBe(spec.side);
      const L = pathLength(t.centerline, t.pit.start, t.pit.end);
      expect(L, `${id}: pit >= 120 m`).toBeGreaterThanOrEqual(120);
      expect(L, `${id}: pit <= budget`).toBeLessThanOrEqual(spec.toMeters - spec.fromMeters);
    }
  });
});

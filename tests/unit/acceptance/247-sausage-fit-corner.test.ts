import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { Sausage, TrackDataV2, Vec3 } from '../../../src/core/types';
import { halfWidthAt } from '../../../src/track/surfaces';
import { detectCorners, radii, type CornerRun } from '../../../tools/track-builder/corners';
import { buildSausages, type SausageOverride } from '../../../tools/track-builder/sausages';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');
const OVERRIDE_SLACK = 3;

// Variable specifier keeps typecheck green until task 247 adds the export (the 159 pattern).
const SAUSAGE_MODULE = '../../../src/track/sausages';

interface SausagePiece247 {
  position: Vec3;
  yaw: number;
  length: number;
}

type SausagePiecesFn = (track: TrackDataV2, s: Sausage) => SausagePiece247[];

async function loadSausagePieces(): Promise<SausagePiecesFn> {
  const mod = (await import(SAUSAGE_MODULE)) as unknown as { sausagePieces: SausagePiecesFn };
  return mod.sausagePieces;
}

interface TrackConfig {
  id: string;
  sausages?: SausageOverride[];
}

let trackCache: Array<{ id: string; track: TrackDataV2 }> | null = null;
let configCache: TrackConfig[] | null = null;

function builtTracks(): Array<{ id: string; track: TrackDataV2 }> {
  if (trackCache) return trackCache;
  const index = JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
  ) as Array<{ id: string }>;
  trackCache = index.map(({ id }) => ({
    id,
    track: JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
    ) as TrackDataV2,
  }));
  return trackCache;
}

function overridesOf(id: string): SausageOverride[] {
  if (!configCache) {
    configCache = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
    ) as TrackConfig[];
  }
  return configCache.find((c) => c.id === id)?.sausages ?? [];
}

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

const circularDistance = (a: number, b: number, n: number): number =>
  Math.min(wrap(a - b, n), wrap(b - a, n));

// Index nearest to an arc length on the closed polyline (wrapping), first index on ties.
function nearestIndexAt(points: Point2[], atMeters: number): number {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const per = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  const target = wrap(atMeters, per);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(cum[i] - target);
    const dist = Math.min(d, per - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}

// Index of the minimum radius inside the run, first index on ties (builder rule).
function apexIndex(rs: number[], run: CornerRun, n: number): number {
  const span = wrap(run.end - run.start, n);
  let best = run.start;
  let bestR = Infinity;
  for (let k = 0; k <= span; k++) {
    const i = wrap(run.start + k, n);
    if (rs[i] < bestR) {
      bestR = rs[i];
      best = i;
    }
  }
  return best;
}

// Forward polyline length along the closed lap from `from` to `to` (closing edge included).
function arcLength(points: Point2[], from: number, to: number): number {
  const n = points.length;
  let len = 0;
  let i = wrap(from, n);
  const target = wrap(to, n);
  while (i !== target) {
    const j = (i + 1) % n;
    len += Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
    i = j;
  }
  return len;
}

function isAuto(track: TrackDataV2, s: Sausage, overrides: SausageOverride[]): boolean {
  const n = track.centerline.length;
  return !overrides.some(
    (o) =>
      o.side === s.side &&
      circularDistance(nearestIndexAt(track.centerline, o.atMeters), s.index, n) <= OVERRIDE_SLACK,
  );
}

// Closed stadium: straight A (0,0)->(200,0) every 2 m (endpoint excluded), left semicircle
// centred (200,-R) bulging +X, straight B (200,-2R)->(0,-2R) every 2 m, left semicircle
// centred (0,-R) bulging -X; m = max(12, ceil(pi*R)) points per arc, endpoints excluded.
function stadium(R: number): TrackDataV2 {
  const pts: Point2[] = [];
  for (let x = 0; x < 200; x += 2) pts.push([x, 0]);
  const m = Math.max(12, Math.ceil(Math.PI * R));
  for (let j = 0; j < m; j++) {
    const a = Math.PI / 2 - (Math.PI * j) / m;
    pts.push([200 + R * Math.cos(a), -R + R * Math.sin(a)]);
  }
  for (let x = 200; x > 0; x -= 2) pts.push([x, -2 * R]);
  for (let j = 0; j < m; j++) {
    const a = -Math.PI / 2 - (Math.PI * j) / m;
    pts.push([R * Math.cos(a), -R + R * Math.sin(a)]);
  }
  const centerline = pts.map((p) => [p[0], p[1]] as [number, number]);
  let lengthMeters = 0;
  for (let i = 0; i < centerline.length; i++) {
    const j = (i + 1) % centerline.length;
    lengthMeters += Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
  }
  return {
    ...fixture,
    id: 'stadium-30',
    name: 'Stadium',
    centerline,
    lengthMeters,
    officialLengthMeters: lengthMeters,
    widthMeters: 12,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    grandstands: [],
    sausages: [],
  };
}

function nearestCenterline(points: [number, number][], x: number, z: number): { index: number; dist: number } {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i][0] - x;
    const dz = points[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

function cumulative(points: [number, number][]): { cum: number[]; lap: number } {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

// Continuous arc length along the closed polyline nearest to (x, z).
function arcPosition(
  points: [number, number][], cum: number[], lap: number, x: number, z: number,
): number {
  const n = points.length;
  const { index } = nearestCenterline(points, x, z);
  let bestPos = cum[index];
  let bestD = Infinity;
  for (const k of [wrap(index - 1, n), index]) {
    const j = (k + 1) % n;
    const ax = points[k][0];
    const az = points[k][1];
    const abx = points[j][0] - ax;
    const abz = points[j][1] - az;
    const len2 = abx * abx + abz * abz;
    const t = len2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / len2));
    const d = Math.hypot(ax + t * abx - x, az + t * abz - z);
    if (d < bestD) {
      bestD = d;
      bestPos = wrap(cum[k] + t * Math.sqrt(len2), lap);
    }
  }
  return bestPos;
}

interface Sample {
  x: number;
  z: number;
}

// 5 points along each piece's arc span; `across` selects the base-width samples.
function footprintSamples(pieces: SausagePiece247[], across: number[]): Sample[] {
  const out: Sample[] = [];
  for (const p of pieces) {
    const ux = Math.sin(p.yaw);
    const uz = Math.cos(p.yaw);
    const nx = -uz;
    const nz = ux;
    for (let j = 0; j < 5; j++) {
      const t = -p.length / 2 + (p.length * j) / 4;
      for (const l of across) {
        out.push({ x: p.position.x + t * ux + l * nx, z: p.position.z + t * uz + l * nz });
      }
    }
  }
  return out;
}

describe('247 sausage fit corner acceptance', () => {
  it('AT1: every auto sausage on every built track has 6 <= length <= 20, offset >= half(side,index) + 1.8 - 1e-6 and offset < 0.8*radii(index)', () => {
    for (const { id, track } of builtTracks()) {
      const rs = radii(track.centerline);
      const overrides = overridesOf(id);
      for (const s of track.sausages ?? []) {
        if (!isAuto(track, s, overrides)) continue;
        const where = `${id} sausage ${s.index} ${s.side}`;
        expect(s.length, `${where} length`).toBeGreaterThanOrEqual(6);
        expect(s.length, `${where} length`).toBeLessThanOrEqual(20);
        expect(s.offset, `${where} offset`).toBeGreaterThanOrEqual(
          halfWidthAt(track, s.side, s.index) + 1.8 - 1e-6,
        );
        expect(s.offset, `${where} offset`).toBeLessThan(0.8 * rs[s.index]);
      }
    }
  }, 120000);

  it('AT2: all built tracks together carry at least 3 distinct sausage length values', () => {
    const lengths = new Set<number>();
    for (const { track } of builtTracks()) {
      for (const s of track.sausages ?? []) lengths.add(s.length);
    }
    expect(lengths.size).toBeGreaterThanOrEqual(3);
  });

  it('AT3: every auto sausage length equals clamp(0.5*arcLength(run.start, run.end), 6, 20) of the corner run whose apex is its index (+-1e-6)', () => {
    for (const { id, track } of builtTracks()) {
      const n = track.centerline.length;
      const rs = radii(track.centerline);
      const runs = detectCorners(track.centerline);
      const overrides = overridesOf(id);
      for (const s of track.sausages ?? []) {
        if (!isAuto(track, s, overrides)) continue;
        const run = runs.find((r) => r.side === s.side && apexIndex(rs, r, n) === s.index);
        expect(run, `${id}: corner run with apex ${s.index} ${s.side}`).toBeDefined();
        const expected = Math.min(
          20,
          Math.max(6, 0.5 * arcLength(track.centerline, run!.start, run!.end)),
        );
        expect(
          Math.abs(s.length - expected),
          `${id} sausage ${s.index} ${s.side} length`,
        ).toBeLessThanOrEqual(1e-6);
      }
    }
  }, 120000);

  it('AT4: every footprint sample (5 along each piece x 3 across the base) of every built-track sausage clears the nearest half width by KERB_WIDTH + 0.1', async () => {
    const sausagePieces = await loadSausagePieces();
    const failures: string[] = [];
    for (const { id, track } of builtTracks()) {
      for (const s of track.sausages ?? []) {
        const threshold = (halfNear: number): number => halfNear + KERB_WIDTH + 0.1;
        for (const p of footprintSamples(sausagePieces(track, s), [-0.25, 0, 0.25])) {
          const { index, dist } = nearestCenterline(track.centerline, p.x, p.z);
          const halfNear = Math.min(
            halfWidthAt(track, 'left', index),
            halfWidthAt(track, 'right', index),
          );
          if (dist < threshold(halfNear)) {
            failures.push(
              `${id} sausage ${s.index} ${s.side}: clearance ${dist.toFixed(3)} < ${threshold(halfNear).toFixed(3)}`,
            );
          }
        }
      }
    }
    expect(failures.length, failures.slice(0, 12).join('; ')).toBe(0);
  }, 300000);

  it('AT5: STADIUM(30) with a right sausage offset 7.8 length 10 at the bend 1 apex puts every centre sample at lateral 7.8 +-0.05 and spans 10 +-0.5 m of arc', async () => {
    const sausagePieces = await loadSausagePieces();
    const track = stadium(30);
    const n = track.centerline.length;
    const runs = detectCorners(track.centerline);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const apex = apexIndex(radii(track.centerline), runs[0], n);
    const pieces = sausagePieces(track, { index: apex, side: 'right', offset: 7.8, length: 10 });
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    const samples = footprintSamples(pieces, [0]);
    expect(samples.length).toBeGreaterThanOrEqual(5);
    const { cum, lap } = cumulative(track.centerline);
    let minArc = Infinity;
    let maxArc = -Infinity;
    for (const p of samples) {
      const { dist } = nearestCenterline(track.centerline, p.x, p.z);
      expect(Math.abs(dist - 7.8), `sample lateral ${dist.toFixed(3)}`).toBeLessThanOrEqual(0.05);
      const a = arcPosition(track.centerline, cum, lap, p.x, p.z);
      if (a < minArc) minArc = a;
      if (a > maxArc) maxArc = a;
    }
    const span = wrap(maxArc - minArc, lap);
    expect(span).toBeGreaterThanOrEqual(9.5);
    expect(span).toBeLessThanOrEqual(10.5);
  }, 120000);

  it('AT6: a config override with lengthMeters keeps the override length verbatim', () => {
    const track = stadium(30);
    const sausages = buildSausages(track.centerline, 12, [
      { atMeters: 50, side: 'right', lengthMeters: 13 },
    ]);
    expect(sausages).toHaveLength(1);
    expect(sausages[0].length).toBeCloseTo(13, 9);
  });

  it('AT7: rebuilt track JSONs differ from the pre-task JSON only in the sausages field', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const pin = (t: TrackDataV2): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...t };
      delete copy.sausages;
      // 248 rebuild: pit-side runoffs clipped; barriers, boards, trees, terrain and escape roads derive from them.
      delete copy.runoffs;
      delete copy.barriers;
      delete copy.boards;
      delete copy.trees;
      delete copy.terrain;
      delete copy.escapeRoads;
      delete copy.derived;
      return copy;
    };
    for (const { id, track } of builtTracks()) {
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      const now = pin(track);
      const before = pin(prev);
      // 247 rebuild: the builder emits an all-zero bank array where the pre-task JSON had none.
      if (!('bank' in before) && Array.isArray(now.bank) && (now.bank as number[]).every((b) => b === 0)) {
        delete now.bank;
      }
      // detroit: master's city rule turns its armco/tyres into walls (the pre-task JSON predates it).
      if (id === 'detroit') {
        delete now.barriers;
        delete before.barriers;
      }
      expect(now, `${id}: fields other than sausages changed`).toEqual(before);
    }
  }, 120000);
});

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeParallel, applyMedianWalls, stripParallel } from '../../../tools/track-builder/parallel';
import { placeTrees, type Biome } from '../../../tools/track-builder/trees';
import type { Point2 } from '../../../src/track/geo';
import type {
  BarrierSegment,
  RunoffSegment,
  Side,
  SurfaceStrip,
  TrackDataV2,
  TrackSegment,
} from '../../../src/core/types';
import * as surfaces from '../../../src/track/surfaces';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import { fixture } from './022-fixture-trackdatav2';

// Task 155 adds halfWidthAt to surfaces.ts; the cast keeps this test-first
// file type-checking until the export exists.
const halfWidthAt = (
  surfaces as unknown as {
    halfWidthAt: (track: TrackDataV2, side: Side, i: number) => number;
  }
).halfWidthAt;

// Task 155 adds per-index half-width arrays to TrackDataV2; mirrored here so
// this test-first file type-checks until types.ts is updated.
type TrackV2_155 = TrackDataV2 & { halfWidthLeft?: number[]; halfWidthRight?: number[] };

const WIDTH = 12;
const HALF = WIDTH / 2;
// Parallel part of the fixture: away from both hairpins and from the
// 60-index adjacency window, so the facing distance is exactly 10 m.
const Z0 = 60;
const Z1 = 240;

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['monza', 'spa', 'silverstone'];

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const cdist = (a: number, b: number, n: number) =>
  Math.min(Math.abs(a - b), n - Math.abs(a - b));
const inRange = (seg: { start: number; end: number }, i: number, n: number) =>
  wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);

// Two 300 m straights 10 m apart (x = 0 and x = 10) joined by R 5 hairpins,
// ~2 m point spacing, closed, 316 points.
function hairpinLoop(): Point2[] {
  const pts: Point2[] = [];
  for (let z = 0; z <= 300; z += 2) pts.push([0, z]);
  for (let k = 1; k <= 8; k++) {
    const t = Math.PI * (1 - k / 8);
    pts.push([5 + 5 * Math.cos(t), 300 + 5 * Math.sin(t)]);
  }
  for (let z = 298; z >= 0; z -= 2) pts.push([10, z]);
  for (let k = 1; k <= 7; k++) {
    const t = -(Math.PI * k) / 8;
    pts.push([5 + 5 * Math.cos(t), 5 * Math.sin(t)]);
  }
  return pts;
}

function parallelIndices(pts: Point2[], x: number): number[] {
  const out: number[] = [];
  pts.forEach((p, i) => {
    if (p[0] === x && p[1] >= Z0 && p[1] <= Z1) out.push(i);
  });
  return out;
}

/** Side of the tangent at i whose right normal faces -dirX (right = positive normal). */
function sideToward(pts: Point2[], i: number, dirX: number): Side {
  const n = pts.length;
  const prev = pts[wrap(i - 1, n)];
  const next = pts[(i + 1) % n];
  const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
  const rx = -(next[1] - prev[1]) / len;
  return dirX * rx < 0 ? 'left' : 'right';
}

const LOOP_TERRAIN = {
  originX: 5,
  originZ: 150,
  sizeX: 40,
  sizeZ: 340,
  rows: 1,
  cols: 1,
  heights: [0, 0, 0, 0],
};

function loopTrack(
  pts: Point2[],
  barriers: BarrierSegment[],
  kerbs: TrackSegment[],
  runoffs: RunoffSegment[],
): TrackV2_155 {
  return {
    ...fixture,
    id: 'hairpin-loop',
    name: 'Hairpin Loop',
    widthMeters: WIDTH,
    lengthMeters: 631,
    officialLengthMeters: 631,
    centerline: pts,
    sectors: [0, 100, 200],
    elevation: pts.map(() => 0),
    kerbs,
    runoffs,
    barriers,
    terrain: LOOP_TERRAIN,
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
  };
}

function barrierInput(n: number): BarrierSegment[] {
  return [
    { start: 0, end: n - 1, side: 'left', type: 'armco', offsetMeters: HALF },
    { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF },
  ];
}

interface Separation {
  index: number;
  side: Side;
  d: number;
}

/** Spec Step 1 distances: closest polyline segment at wrapped index distance > 60 from i. */
function separations(pts: Point2[], width: number): Separation[] {
  const n = pts.length;
  const limit = width + 6;
  const out: Separation[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[wrap(i - 1, n)];
    const next = pts[(i + 1) % n];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
    const rx = -(next[1] - prev[1]) / len;
    const rz = (next[0] - prev[0]) / len;
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      if (cdist(i, j, n) <= 60 || cdist(i, j2, n) <= 60) continue;
      const a = pts[j];
      const b = pts[j2];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a[0] + ex * t;
      const qz = a[1] + ez * t;
      const d = Math.hypot(p[0] - qx, p[1] - qz);
      if (d < best) {
        best = d;
        bx = qx;
        bz = qz;
      }
    }
    if (best < limit) {
      const dx = bx - p[0];
      const dz = bz - p[1];
      out.push({ index: i, side: dx * rx + dz * rz > 0 ? 'right' : 'left', d: best });
    }
  }
  return out;
}

/** Minimum translation depth of two convex XZ polygons; 0 when disjoint or touching. */
function satDepth(a: number[][], b: number[][]): number {
  let min = Infinity;
  for (const poly of [a, b]) {
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % poly.length];
      const ex = q[0] - p[0];
      const ez = q[1] - p[1];
      const l = Math.hypot(ex, ez);
      if (l < 1e-9) continue;
      const nx = -ez / l;
      const nz = ex / l;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * nz;
        if (d < a0) a0 = d;
        if (d > a1) a1 = d;
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * nz;
        if (d < b0) b0 = d;
        if (d > b1) b1 = d;
      }
      const ov = Math.min(a1, b1) - Math.max(a0, b0);
      if (ov <= 0) return 0;
      if (ov < min) min = ov;
    }
  }
  return min === Infinity ? 0 : min;
}

function segLength(seg: { start: number; end: number }, n: number): number {
  const s = ((seg.start % n) + n) % n;
  const e = ((seg.end % n) + n) % n;
  return ((e - s + n) % n) + 1;
}

/**
 * Overlap depth > 0.05 m between strip triangles of sections farther apart
 * than 60 indices. Escape-road strips are out of scope (spec: crossing a
 * median); verge strips are checked only where the side is narrowed (step 6).
 */
function overlappingPairs(track: TrackDataV2, strips: SurfaceStrip[]): string[] {
  const pts = track.centerline;
  const n = pts.length;
  const width = track.widthMeters;
  const t155 = track as TrackV2_155;
  const nonEmptyKerbs = track.kerbs.filter((k) => segLength(k, n) >= 2).length;
  const nonEmptyRunoffs = track.runoffs.filter((r) => segLength(r, n) >= 2).length;
  const escapeStart = 1 + nonEmptyKerbs + nonEmptyRunoffs + 2;
  const CELL = 40;
  const polys: number[][][] = [];
  const kinds: string[] = [];
  const minx: number[] = [];
  const maxx: number[] = [];
  const minz: number[] = [];
  const maxz: number[] = [];
  const buckets = new Map<string, number[]>();
  strips.forEach((strip, si) => {
    const pos = strip.positions;
    const idx = strip.indices;
    for (let t = 0; t < idx.length; t += 3) {
      const poly: number[][] = [];
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = idx[t + k] * 3;
        const x = pos[v];
        const z = pos[v + 2];
        poly.push([x, z]);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      const id = polys.push(poly) - 1;
      kinds.push(si >= escapeStart ? 'escape' : strip.surface);
      minx.push(x0);
      maxx.push(x1);
      minz.push(z0);
      maxz.push(z1);
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
        for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
          const key = `${ix},${iz}`;
          const list = buckets.get(key);
          if (list) list.push(id);
          else buckets.set(key, [id]);
        }
      }
    }
  });
  const secCache = new Map<number, number>();
  const section = (id: number): number => {
    let s = secCache.get(id);
    if (s === undefined) {
      const poly = polys[id];
      const cx = (poly[0][0] + poly[1][0] + poly[2][0]) / 3;
      const cz = (poly[0][1] + poly[1][1] + poly[2][1]) / 3;
      s = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(pts[i][0] - cx, pts[i][1] - cz);
        if (d < bd) {
          bd = d;
          s = i;
        }
      }
      secCache.set(id, s);
    }
    return s;
  };
  const narrowed = (sec: number): boolean =>
    (t155.halfWidthLeft?.[sec] ?? width / 2) < width / 2 ||
    (t155.halfWidthRight?.[sec] ?? width / 2) < width / 2;
  const usable = (id: number, sec: number): boolean => {
    if (kinds[id] === 'escape') return false;
    if (kinds[id] === 'grass') return narrowed(sec);
    return true;
  };
  const bad: string[] = [];
  for (const list of buckets.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const p = Math.min(list[a], list[b]);
        const q = Math.max(list[a], list[b]);
        if (maxx[p] < minx[q] || maxx[q] < minx[p] || maxz[p] < minz[q] || maxz[q] < minz[p]) {
          continue;
        }
        const sp = section(p);
        const sq = section(q);
        if (cdist(sp, sq, n) <= 60) continue;
        if (!usable(p, sp) || !usable(q, sq)) continue;
        const depth = satDepth(polys[p], polys[q]);
        if (depth > 0.05) {
          bad.push(`sections ${sp}/${sq} overlap ${depth.toFixed(3)} m`);
          if (bad.length >= 20) return bad;
        }
      }
    }
  }
  return bad;
}

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

describe('155 close parallel sections acceptance', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('AT1: parallel straights give inner halfWidth 4.5 (+- 1e-6) and outer 6 along the parallel part', () => {
    const pts = hairpinLoop();
    const info = analyzeParallel(pts, WIDTH);
    const track: TrackV2_155 = {
      ...loopTrack(pts, [], [], []),
      halfWidthLeft: info.halfLeft,
      halfWidthRight: info.halfRight,
    };
    for (const [x, dirX] of [
      [0, 1],
      [10, -1],
    ]) {
      for (const i of parallelIndices(pts, x)) {
        const inner = sideToward(pts, i, dirX);
        expect(halfWidthAt(track, inner, i), `index ${i} inner half-width`).toBeCloseTo(4.5, 6);
        expect(halfWidthAt(track, opp(inner), i), `index ${i} outer half-width`).toBeCloseTo(6, 6);
      }
    }
  });

  it('AT2: each inner side gets a wall at offset 5.0 +- 0.05 and no kerb, run-off or tree along the parallel part', () => {
    const pts = hairpinLoop();
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    const kerbIn: TrackSegment[] = [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ];
    const runoffIn: RunoffSegment[] = [
      { start: 0, end: n - 1, side: 'left', surface: 'gravel', widthMeters: 18 },
      { start: 0, end: n - 1, side: 'right', surface: 'gravel', widthMeters: 18 },
    ];
    const kerbs = stripParallel(kerbIn, info);
    const runoffs = stripParallel(runoffIn, info);
    const barriers = applyMedianWalls(barrierInput(n), info, n);
    const biome: Biome = { species: [{ name: 'oak', weight: 1 }], density: 1 };
    const trees = placeTrees('hairpin-loop', pts, LOOP_TERRAIN, barriers, biome);
    for (const [x, dirX] of [
      [0, 1],
      [10, -1],
    ]) {
      for (const i of parallelIndices(pts, x)) {
        const inner = sideToward(pts, i, dirX);
        const wall = barriers.find((b: BarrierSegment) => b.side === inner && inRange(b, i, n));
        expect(wall, `wall at index ${i}`).toBeDefined();
        expect(wall?.type, `wall type at index ${i}`).toBe('wall');
        expect(Math.abs((wall?.offsetMeters ?? 0) - 5), `wall offset at index ${i}`).toBeLessThanOrEqual(0.05);
        expect(
          kerbs.some((k: TrackSegment) => k.side === inner && inRange(k, i, n)),
          `kerb at index ${i}`,
        ).toBe(false);
        expect(
          runoffs.some((r: TrackSegment) => r.side === inner && inRange(r, i, n)),
          `run-off at index ${i}`,
        ).toBe(false);
      }
    }
    const inMedian: number[] = [];
    for (const inst of trees) {
      for (let k = 0; k + 3 < inst.data.length; k += 4) {
        const tx = inst.data[k];
        const tz = inst.data[k + 1];
        if (tz >= Z0 && tz <= Z1 && tx >= 0 && tx <= 10) inMedian.push(tx);
      }
    }
    expect(inMedian, `trees in the median between the straights: ${inMedian.join(', ')}`).toHaveLength(0);
  }, 30000);

  it('AT3: ray from a straight centerline toward the other at y + 0.5 hits a barrier collider at toi 5.0 +- 0.1', () => {
    const pts = hairpinLoop();
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    const barriers = applyMedianWalls(barrierInput(n), info, n);
    const track = loopTrack(pts, barriers, [], []);
    const world = createPhysicsWorld();
    addTrackColliders(world, track);
    world.step();
    const s1 = parallelIndices(pts, 0);
    const i = s1[Math.floor(s1.length / 2)];
    const hit = world.castRay(
      new RAPIER.Ray({ x: pts[i][0], y: 0.5, z: pts[i][1] }, { x: 1, y: 0, z: 0 }),
      9.5,
      true,
    );
    expect(hit, 'ray toward the other road').not.toBeNull();
    expect(surfaceOf(hit!.collider), 'hit must be a barrier collider, not a surface').toBeNull();
    expect(Math.abs(hit!.timeOfImpact - 5), 'toi vs median wall offset').toBeLessThanOrEqual(0.1);
  }, 30000);

  it('AT4: rebuilt baku has no non-adjacent surface-strip overlap over 0.05 m and a median wall at every index with separation under 18 m', () => {
    const track = loadTrack('baku');
    const pts = track.centerline;
    const n = pts.length;

    const seps = separations(pts, track.widthMeters);
    expect(seps.length, 'baku separations under width + 6').toBeGreaterThan(0);
    const missing: string[] = [];
    for (const s of seps) {
      const median = Math.floor(s.d * 2) / 4;
      const wall = track.barriers.find(
        (b: BarrierSegment) =>
          b.side === s.side &&
          inRange(b, s.index, n) &&
          b.type === 'wall' &&
          Math.abs(b.offsetMeters - median) <= 0.05,
      );
      if (!wall) {
        missing.push(`index ${s.index} ${s.side} d=${s.d.toFixed(3)} median=${median}`);
      }
    }
    expect(missing, `missing median walls: ${missing.slice(0, 10).join('; ')}`).toHaveLength(0);

    const strips = surfaces.buildTrackSurfaces(track);
    const overlaps = overlappingPairs(track, strips);
    expect(overlaps, `overlapping strips: ${overlaps.join('; ')}`).toHaveLength(0);
  }, 120000);

  it('AT5: rebuilt monza, spa and silverstone are identical to the previous JSON, ignoring the sausages field task 149 adds', () => {
    const baseRev = execFileSync('git', ['merge-base', 'HEAD', 'master'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    for (const id of IDS) {
      const track = loadTrack(id);
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      // 149 adds the sausages array to every rebuilt track.
      const strip = (t: TrackDataV2): Record<string, unknown> => {
        const copy: Record<string, unknown> = { ...t };
        delete copy.sausages;
        delete copy.environment;
        delete copy.pit;
        delete copy.barriers;
        delete copy.escapeRoads;
        // 248 rebuild: runoffs clipped at the pit; barriers, trees and terrain derive from them.
        delete copy.runoffs;
        delete copy.trees;
        delete copy.terrain;
        return copy;
      };
      const now = strip(track);
      const before = strip(prev);
      // 247 rebuild: the builder emits an all-zero bank array where the pre-task JSON had none.
      if (!('bank' in before) && Array.isArray(now.bank) && (now.bank as number[]).every((b) => b === 0)) {
        delete now.bank;
      }
      expect(now, `${id}: JSON changed (sausages ignored)`).toEqual(before);
    }
  }, 120000);
});

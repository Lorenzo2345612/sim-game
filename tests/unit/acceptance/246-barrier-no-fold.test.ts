import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BarrierSegment, Side, Terrain, TrackDataV2 } from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';
import { barrierRuns, rightNormalAt, type BarrierVertex } from '../../../src/track/barrierPath';
import { groundHeightAt } from '../../../src/track/ground';
import * as surfaces from '../../../src/track/surfaces';
import { analyzeParallel, applyMedianWalls } from '../../../tools/track-builder/parallel';

const ROOT = join(__dirname, '..', '..', '..');
const WIDTH = 12;
const HALF = WIDTH / 2;
// halfNear + KERB_WIDTH + 0.5 on the flat 12 m fixtures = 7.7 m.
const THRESHOLD = HALF + KERB_WIDTH + 0.5;

// Task 246 adds the export; the cast keeps this test-first file type-checking until then.
const cornerCurvature = (
  surfaces as unknown as {
    cornerCurvature: (cx: [number, number][], i: number) => { side: Side; radius: number } | null;
  }
).cornerCurvature;

/** Pre-change barrierRuns (before task 246), frozen here for the "unchanged vs pre-change" rows. */
function legacyBarrierRuns(track: TrackDataV2, side: Side): BarrierVertex[][] {
  const cx = track.centerline;
  const n = cx.length;
  if (n === 0) return [];
  const winner: Array<BarrierSegment | null> = new Array(n).fill(null);
  for (const seg of track.barriers) {
    if (seg.side !== side) continue;
    const count = ((((seg.end - seg.start) % n) + n) % n) + 1;
    for (let k = 0; k < count; k++) {
      winner[(((seg.start + k) % n) + n) % n] = seg;
    }
  }
  const sign = side === 'right' ? 1 : -1;
  const vertexAt = (i: number, seg: BarrierSegment): BarrierVertex => {
    const [rx, rz] = rightNormalAt(cx, i);
    const x = cx[i][0] + sign * seg.offsetMeters * rx;
    const z = cx[i][1] + sign * seg.offsetMeters * rz;
    const y = (track.elevation[i] ?? 0) + sign * seg.offsetMeters * surfaces.bankTanAt(track, i);
    return {
      index: i,
      x,
      z,
      y,
      ground: track.terrain ? groundHeightAt(track, x, z) : y,
      type: seg.type,
    };
  };
  const isMedianWall = (v: BarrierVertex): boolean => {
    const hw = surfaces.halfWidthAt(track, side, v.index);
    if (v.type !== 'wall') return false;
    if (hw < track.widthMeters / 2 - 1e-9) return true;
    const [rx, rz] = rightNormalAt(cx, v.index);
    const offset = Math.abs((v.x - cx[v.index][0]) * rx + (v.z - cx[v.index][1]) * rz);
    return offset < hw;
  };
  const NEAR_INDEX_SPAN = 5;
  const reach = new Array<number>(n);
  let maxReach = 0;
  for (let j = 0; j < n; j++) {
    reach[j] = surfaces.halfWidthAt(track, side, j) + 0.3;
    if (reach[j] > maxReach) maxReach = reach[j];
  }
  const cell = Math.max(maxReach, 1);
  const grid = new Map<string, number[]>();
  for (let j = 0; j < n; j++) {
    const k = `${Math.floor(cx[j][0] / cell)},${Math.floor(cx[j][1] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(j);
    else grid.set(k, [j]);
  }
  const indexDistance = (a: number, b: number): number => {
    const d = Math.abs(a - b) % n;
    return Math.min(d, n - d);
  };
  const crossesTrack = (v: BarrierVertex): boolean => {
    const gx = Math.floor(v.x / cell);
    const gz = Math.floor(v.z / cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const j of grid.get(`${gx + a},${gz + b}`) ?? []) {
          if (indexDistance(j, v.index) <= NEAR_INDEX_SPAN) continue;
          const dx = cx[j][0] - v.x;
          const dz = cx[j][1] - v.z;
          if (dx * dx + dz * dz < reach[j] * reach[j]) return true;
        }
      }
    }
    return false;
  };
  const dropped = (v: BarrierVertex): boolean => !isMedianWall(v) && crossesTrack(v);
  const covered = winner.map((seg) => seg !== null);
  const runs: BarrierVertex[][] = [];
  if (covered.every((c) => c)) {
    const all = Array.from({ length: n }, (_, i) => vertexAt(i, winner[i]!));
    const keep = all.map((v) => !dropped(v));
    if (keep.every((k) => k)) {
      runs.push(all);
      return runs;
    }
    let start = 0;
    while (keep[start]) start = (start + 1) % n;
    let fragment: BarrierVertex[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (keep[i]) fragment.push(all[i]);
      else {
        if (fragment.length >= 2) runs.push(fragment);
        fragment = [];
      }
    }
    return runs;
  }
  for (let i = 0; i < n; i++) {
    if (!covered[i] || covered[(i - 1 + n) % n]) continue;
    const stretch: BarrierVertex[] = [];
    let j = i;
    while (covered[j]) {
      stretch.push(vertexAt(j, winner[j]!));
      j = (j + 1) % n;
      if (j === i) break;
    }
    let anyDrop = false;
    let fragment: BarrierVertex[] = [];
    for (const v of stretch) {
      if (dropped(v)) {
        anyDrop = true;
        if (fragment.length >= 2) runs.push(fragment);
        fragment = [];
      } else {
        fragment.push(v);
      }
    }
    if (!anyDrop) runs.push(stretch);
    else if (fragment.length >= 2) runs.push(fragment);
  }
  return runs;
}

/** STADIUM(R): two 200 m straights (2 m spacing, end excluded) joined by outward R semicircles; left turns. */
function stadiumCenterline(r: number): [number, number][] {
  const pts: [number, number][] = [];
  const m = Math.max(12, Math.ceil(Math.PI * r));
  for (let k = 0; k * 2 < 200; k++) pts.push([k * 2, 0]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([200 + r * Math.sin(t), -r + r * Math.cos(t)]);
  }
  for (let k = 0; k * 2 < 200; k++) pts.push([200 - k * 2, -2 * r]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    pts.push([-r * Math.sin(t), -r - r * Math.cos(t)]);
  }
  return pts;
}

function stadiumTrack(r: number, sides: Side[], offsetMeters: number): TrackDataV2 {
  const centerline = stadiumCenterline(r);
  const n = centerline.length;
  return {
    version: 2,
    id: 'stadium',
    name: 'Stadium',
    widthMeters: WIDTH,
    lengthMeters: 1000,
    officialLengthMeters: 1000,
    centerline,
    sectors: [0, 100, 200],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: sides.map((side) => ({
      start: 0,
      end: n - 1,
      side,
      type: 'armco' as const,
      offsetMeters,
    })),
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' as const },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  } as unknown as TrackDataV2;
}

// Two 300 m straights 10 m apart (x = 0 and x = 10) joined by R 5 hairpins, ~2 m spacing (task 155 fixture).
function hairpinLoop(): [number, number][] {
  const pts: [number, number][] = [];
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

const LOOP_TERRAIN: Terrain = {
  originX: 5,
  originZ: 150,
  sizeX: 40,
  sizeZ: 340,
  rows: 1,
  cols: 1,
  heights: [0, 0, 0, 0],
};

function medianWallTrack(): TrackDataV2 {
  const centerline = hairpinLoop();
  const n = centerline.length;
  const info = analyzeParallel(centerline, WIDTH);
  const barriers = applyMedianWalls(
    [
      { start: 0, end: n - 1, side: 'left', type: 'armco', offsetMeters: HALF },
      { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF },
    ],
    info,
    n,
  );
  return {
    version: 2,
    id: 'hairpin-loop',
    name: 'Hairpin Loop',
    widthMeters: WIDTH,
    lengthMeters: 631,
    officialLengthMeters: 631,
    centerline,
    sectors: [0, 100, 200],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers,
    terrain: LOOP_TERRAIN,
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
}

function clearanceTo(cx: [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (const [px, pz] of cx) {
    const d = Math.hypot(px - x, pz - z);
    if (d < best) best = d;
  }
  return best;
}

function isMedianVertex(track: TrackDataV2, side: Side, v: BarrierVertex): boolean {
  if (v.type !== 'wall') return false;
  const hw = surfaces.halfWidthAt(track, side, v.index);
  if (hw < track.widthMeters / 2 - 1e-9) return true;
  const [rx, rz] = rightNormalAt(track.centerline, v.index);
  const offset = Math.abs(
    (v.x - track.centerline[v.index][0]) * rx + (v.z - track.centerline[v.index][1]) * rz,
  );
  return offset < hw;
}

function expectSameAsLegacy(track: TrackDataV2, side: Side): void {
  const runs = barrierRuns(track, side);
  const legacy = legacyBarrierRuns(track, side);
  expect(runs.length, `${side} run count`).toBe(legacy.length);
  const flat = runs.flat();
  const old = legacy.flat();
  expect(flat.length, `${side} vertex count`).toBe(old.length);
  for (let i = 0; i < flat.length; i++) {
    expect(flat[i].index, `${side} vertex ${i} index`).toBe(old[i].index);
    expect(flat[i].type, `${side} vertex ${i} type`).toBe(old[i].type);
    for (const k of ['x', 'y', 'z', 'ground'] as const) {
      expect(Math.abs(flat[i][k] - old[i][k]), `${side} vertex ${i} ${k}`).toBeLessThanOrEqual(1e-9);
    }
  }
}

describe('246 barrier no-fold acceptance', () => {
  it('AT1: STADIUM(30) armco 12 both sides keeps the pre-change barrierRuns output', () => {
    const track = stadiumTrack(30, ['left', 'right'], 12);
    expectSameAsLegacy(track, 'left');
    expectSameAsLegacy(track, 'right');
  });

  it('AT2: STADIUM(30) left armco 27 puts bend vertices 6 m from the bend centre and straights at offset 27', () => {
    const track = stadiumTrack(30, ['left'], 27);
    const cx = track.centerline;
    const centres: [number, number][] = [
      [200, -30],
      [0, -30],
    ];
    let bends = 0;
    let straights = 0;
    for (const v of barrierRuns(track, 'left').flat()) {
      const cur = cornerCurvature(cx, v.index);
      if (cur !== null && cur.side === 'left' && 0.8 * cur.radius < 27) {
        bends++;
        const d = Math.min(...centres.map(([mx, mz]) => Math.hypot(v.x - mx, v.z - mz)));
        expect(Math.abs(d - 6), `bend vertex ${v.index} distance to bend centre`).toBeLessThanOrEqual(1e-6);
      } else {
        straights++;
        const [rx, rz] = rightNormalAt(cx, v.index);
        const off = Math.abs((v.x - cx[v.index][0]) * rx + (v.z - cx[v.index][1]) * rz);
        expect(Math.abs(off - 27), `straight vertex ${v.index} offset`).toBeLessThanOrEqual(1e-6);
      }
    }
    expect(bends, 'clamped bend vertices').toBeGreaterThan(0);
    expect(straights, 'unclamped straight vertices').toBeGreaterThan(0);
  });

  it('AT3: STADIUM(8) left armco 7.9 keeps no vertex inside the kerb band, splits into at least two runs and leaves the right side unchanged', () => {
    const track = stadiumTrack(8, ['left'], 7.9);
    track.barriers.push({
      start: 0,
      end: track.centerline.length - 1,
      side: 'right',
      type: 'armco',
      offsetMeters: 12,
    });
    const runs = barrierRuns(track, 'left');
    for (const v of runs.flat()) {
      expect(
        clearanceTo(track.centerline, v.x, v.z),
        `left vertex ${v.index} clearance`,
      ).toBeGreaterThanOrEqual(THRESHOLD - 1e-6);
    }
    expect(runs.length, 'left run count').toBeGreaterThanOrEqual(2);
    expectSameAsLegacy(track, 'right');
  });

  it('AT4: the 155 median-wall fixture keeps the pre-change barrierRuns output on both sides', () => {
    const track = medianWallTrack();
    expectSameAsLegacy(track, 'left');
    expectSameAsLegacy(track, 'right');
  });

  it('AT5: every shipped track keeps every non-median barrier vertex at least halfNear + KERB_WIDTH + 0.5 from the centerline', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    let seen = 0;
    for (const { id } of index) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      const cx = track.centerline;
      const halfNearAt = (j: number): number =>
        Math.min(surfaces.halfWidthAt(track, 'left', j), surfaces.halfWidthAt(track, 'right', j));
      let maxThreshold = 0;
      for (let j = 0; j < cx.length; j++) {
        maxThreshold = Math.max(maxThreshold, halfNearAt(j) + KERB_WIDTH + 0.5);
      }
      const cell = Math.max(maxThreshold, 1);
      const grid = new Map<string, number[]>();
      for (let j = 0; j < cx.length; j++) {
        const key = `${Math.floor(cx[j][0] / cell)},${Math.floor(cx[j][1] / cell)}`;
        const list = grid.get(key);
        if (list) list.push(j);
        else grid.set(key, [j]);
      }
      for (const side of ['left', 'right'] as const) {
        for (const v of barrierRuns(track, side).flat()) {
          if (isMedianVertex(track, side, v)) continue;
          seen++;
          const gx = Math.floor(v.x / cell);
          const gz = Math.floor(v.z / cell);
          let best = Infinity;
          let nearest = -1;
          for (let a = -1; a <= 1; a++) {
            for (let b = -1; b <= 1; b++) {
              for (const j of grid.get(`${gx + a},${gz + b}`) ?? []) {
                const dj = Math.abs(j - v.index) % cx.length;
                if (Math.min(dj, cx.length - dj) <= 5) continue;
                const d = Math.hypot(cx[j][0] - v.x, cx[j][1] - v.z);
                if (d < best || (d === best && j < nearest)) {
                  best = d;
                  nearest = j;
                }
              }
            }
          }
          if (nearest >= 0) {
            expect(
              best,
              `${id} ${side} vertex ${v.index} clearance`,
            ).toBeGreaterThanOrEqual(halfNearAt(nearest) + KERB_WIDTH + 0.5 - 1e-6);
          }
        }
      }
    }
    expect(seen, 'non-median vertices checked').toBeGreaterThan(0);
  }, 120000);

  it('AT6: src/track/barrierPath.ts imports no three', () => {
    const src = readFileSync(join(ROOT, 'src', 'track', 'barrierPath.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three['"]/);
  });
});

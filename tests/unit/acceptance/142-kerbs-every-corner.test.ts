import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectKerbs, radii } from '../../../tools/track-builder/corners';
import { CORNER_RADIUS } from '../../../src/core/constants';
import type { Point2 } from '../../../src/track/geo';
import type { Side, TrackDataV2, TrackSegment } from '../../../src/core/types';

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const cdist = (a: number, b: number, n: number) => Math.min(wrap(a - b, n), wrap(b - a, n));

interface Run { start: number; end: number; side: Side; minRadius: number }

// Same formulas as the private analyze() in corners.ts (radii is exported), so expected
// kerb bounds can be derived from run bounds without inventing new APIs.
function cornerRuns(points: Point2[]): Run[] {
  const n = points.length;
  const r = radii(points);
  const sides: (Side | null)[] = points.map((_, i) => {
    const p = points[wrap(i - 5, n)], c = points[i], q = points[(i + 5) % n];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    return r[i] < CORNER_RADIUS ? (cross < 0 ? 'left' : cross > 0 ? 'right' : null) : null;
  });
  let anchor = 0;
  while (anchor < n && sides[anchor] !== null) anchor++;
  const from = anchor < n ? anchor + 1 : 0;
  const runs: Run[] = [];
  let start = -1;
  let side: Side | null = null;
  let minRadius = Infinity;
  for (let k = from; k < from + n; k++) {
    const i = k % n;
    const s = sides[i];
    if (start >= 0 && s !== null && s === side) {
      if (r[i] < minRadius) minRadius = r[i];
      continue;
    }
    if (start >= 0) runs.push({ start, end: wrap(i - 1, n), side: side as Side, minRadius });
    start = s !== null && r[i] < CORNER_RADIUS ? i : -1;
    side = s;
    minRadius = s !== null ? r[i] : Infinity;
  }
  if (start >= 0) runs.push({ start, end: wrap(from + n - 1, n), side: side as Side, minRadius });
  return runs.filter((run) => wrap(run.end - run.start, n) + 1 >= 4 && run.minRadius < CORNER_RADIUS);
}

function coversRange(seg: TrackSegment, from: number, to: number, n: number): boolean {
  const span = wrap(to - from, n);
  for (let j = 0; j <= span; j++) {
    const i = wrap(from + j, n);
    if (wrap(i - seg.start, n) > wrap(seg.end - seg.start, n)) return false;
  }
  return true;
}

// Rounded square: 4 straights of 600 m + 4 quarter-circle arcs of radius R, ~2 m spacing.
function roundedSquare(R: number): Point2[] {
  const L = 600 + 2 * R;
  const pts: Point2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    const k = Math.round((Math.PI / 2) * R / 2);
    for (let j = 1; j <= k; j++) {
      const a = ((a0 + (90 * j) / k) * Math.PI) / 180;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  };
  for (let i = 1; i <= 300; i++) pts.push([R + 2 * i, 0]);
  arc(L - R, R, -90);
  for (let i = 1; i <= 300; i++) pts.push([L, R + 2 * i]);
  arc(L - R, L - R, 0);
  for (let i = 1; i <= 300; i++) pts.push([L - R - 2 * i, L]);
  arc(R, L - R, 90);
  for (let i = 1; i <= 300; i++) pts.push([0, L - R - 2 * i]);
  arc(R, R, 180);
  return pts;
}

// Closed loop (180-degree rotation symmetric): two clusters of two adjacent R 300 arcs
// separated by a short R 500 flat, so same-side kerbs of adjacent runs touch.
function clusterLoop(): Point2[] {
  const seq = [
    { R: 300, deg: 30 }, { R: 500, deg: 4 }, { R: 300, deg: 30 }, { R: 700, deg: 116 },
  ];
  let px = 0, pz = 0, heading = 0;
  const pts: Point2[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const { R, deg } of seq) {
      const span = (deg * Math.PI) / 180;
      const cx = px - R * Math.sin(heading), cz = pz + R * Math.cos(heading);
      const a0 = Math.atan2(pz - cz, px - cx);
      const k = Math.max(1, Math.round((R * span) / 2));
      for (let j = 1; j <= k; j++) {
        const a = a0 + (span * j) / k;
        pts.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]);
      }
      px = pts[pts.length - 1][0];
      pz = pts[pts.length - 1][1];
      heading += span;
    }
  }
  return pts;
}

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['monza', 'spa', 'silverstone'];

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

describe('142 kerbs on every corner acceptance', () => {
  it('AT1: rounded square with 600 m straights and R 300 quarter arcs gives 8 kerbs, per arc an inside [start-15, end+15] and an outside exit [end-5, end+20] and no outside entry kerb', () => {
    const pts = roundedSquare(300);
    const n = pts.length;
    const runs = cornerRuns(pts);
    expect(runs).toHaveLength(4);
    for (const run of runs) expect(run.minRadius).toBeGreaterThanOrEqual(150);
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(8);
    for (const run of runs) {
      const inside = kerbs.filter(
        (k) => k.side === run.side &&
          cdist(k.start, wrap(run.start - 15, n), n) <= 1 &&
          cdist(k.end, wrap(run.end + 15, n), n) <= 1,
      );
      const exit = kerbs.filter(
        (k) => k.side === opp(run.side) &&
          cdist(k.start, wrap(run.end - 5, n), n) <= 1 &&
          cdist(k.end, wrap(run.end + 20, n), n) <= 1,
      );
      expect(inside).toHaveLength(1);
      expect(exit).toHaveLength(1);
    }
  });

  it('AT2: same rounded square with R 30 quarter arcs gives 12 kerbs, per arc inside [start-15, end+15], outside entry [start-20, start+5] and outside exit [end-5, end+20]', () => {
    const pts = roundedSquare(30);
    const n = pts.length;
    const runs = cornerRuns(pts);
    expect(runs).toHaveLength(4);
    for (const run of runs) expect(run.minRadius).toBeLessThan(150);
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(12);
    for (const run of runs) {
      const inside = kerbs.filter(
        (k) => k.side === run.side &&
          cdist(k.start, wrap(run.start - 15, n), n) <= 1 &&
          cdist(k.end, wrap(run.end + 15, n), n) <= 1,
      );
      const entry = kerbs.filter(
        (k) => k.side === opp(run.side) &&
          cdist(k.start, wrap(run.start - 20, n), n) <= 1 &&
          cdist(k.end, wrap(run.start + 5, n), n) <= 1,
      );
      const exit = kerbs.filter(
        (k) => k.side === opp(run.side) &&
          cdist(k.start, wrap(run.end - 5, n), n) <= 1 &&
          cdist(k.end, wrap(run.end + 20, n), n) <= 1,
      );
      expect(inside).toHaveLength(1);
      expect(entry).toHaveLength(1);
      expect(exit).toHaveLength(1);
    }
  });

  it('AT3: rounded square with R 500 quarter arcs gives no kerbs', () => {
    expect(detectKerbs(roundedSquare(500))).toHaveLength(0);
  });

  it('AT4: same-side kerbs of two adjacent runs whose ranges touch merge into one kerb spanning both', () => {
    const pts = clusterLoop();
    const n = pts.length;
    const runs = cornerRuns(pts).sort((a, b) => a.start - b.start);
    expect(runs).toHaveLength(4);
    const pairs = [[runs[0], runs[1]], [runs[2], runs[3]]];
    for (const [p, q] of pairs) {
      expect(p.side).toBe(q.side);
      const gap = wrap(q.start - p.end, n);
      expect(gap).toBeLessThanOrEqual(31); // kerbs touch: next.start <= prev.end + 1 under +-15 extension
      expect(gap).toBeGreaterThanOrEqual(2); // still two distinct runs
    }
    expect(wrap(pairs[1][0].start - pairs[0][1].end, n)).toBeGreaterThan(31);
    expect(wrap(pairs[0][0].start - pairs[1][1].end, n)).toBeGreaterThan(31);
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(6); // 2 merged inside + 4 exits, not 4 inside + 4 exits
    for (const [p, q] of pairs) {
      const merged = kerbs.filter(
        (k) => k.side === p.side &&
          cdist(k.start, wrap(p.start - 15, n), n) <= 1 &&
          cdist(k.end, wrap(q.end + 15, n), n) <= 1,
      );
      expect(merged).toHaveLength(1);
    }
    for (const run of runs) {
      const exit = kerbs.filter(
        (k) => k.side === opp(run.side) &&
          cdist(k.start, wrap(run.end - 5, n), n) <= 1 &&
          cdist(k.end, wrap(run.end + 20, n), n) <= 1,
      );
      expect(exit).toHaveLength(1);
    }
  });

  it('AT5: rebuilt monza/spa/silverstone give every corner run an inside kerb covering [start-15, end+15] and keep centerline, elevation and pit identical to the previous JSON', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    for (const id of IDS) {
      const track = loadTrack(id);
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      for (const key of ['centerline', 'elevation', 'pit'] as const) {
        expect(track[key], `${id}: ${key} changed`).toEqual(prev[key]);
      }
      const n = track.centerline.length;
      const missing = cornerRuns(track.centerline)
        .filter((run) => !track.kerbs.some(
          (k) => k.side === run.side && coversRange(k, run.start - 15, run.end + 15, n),
        ))
        .map((run) => `[${run.start},${run.end}] ${run.side}`);
      expect(missing, `${id}: corner runs without inside kerb: ${missing.slice(0, 10).join('; ')}`).toHaveLength(0);
    }
  });
});

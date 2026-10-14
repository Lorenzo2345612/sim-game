import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectKerbs, radii } from '../../../tools/track-builder/corners';
import { CORNER_RADIUS, KERB_RADIUS } from '../../../src/core/constants';
import type { Point2 } from '../../../src/track/geo';
import type { Side, TrackDataV2, TrackSegment } from '../../../src/core/types';

const w = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const cdist = (a: number, b: number, n: number) => Math.min(w(a - b, n), w(b - a, n));
const covers = (seg: TrackSegment, i: number, n: number) => w(i - seg.start, n) <= w(seg.end - seg.start, n);

function circle(R: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)]; // counter-clockwise: every point turns 'left'
  });
}

interface Run { start: number; end: number; side: Side; minRadius: number }

// Mirror of the private analyze() in corners.ts (same derivation the 142 acceptance tests use).
function cornerRuns(points: Point2[]): Run[] {
  const n = points.length;
  const r = radii(points);
  const sides: (Side | null)[] = points.map((_, i) => {
    const p = points[w(i - 5, n)], c = points[i], q = points[w(i + 5, n)];
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
    if (start >= 0) runs.push({ start, end: w(i - 1, n), side: side as Side, minRadius });
    start = s !== null && r[i] < CORNER_RADIUS ? i : -1;
    side = s;
    minRadius = s !== null ? r[i] : Infinity;
  }
  if (start >= 0) runs.push({ start, end: w(from + n - 1, n), side: side as Side, minRadius });
  return runs;
}

// Closed 180-symmetric loop like the AT4 cluster, but ordered so the touch junction of the
// two same-side R300 arcs sits across index 0: their inside kerbs must merge cyclically.
function wrapMergeLoop(): Point2[] {
  const seq = [
    { R: 500, deg: 4 }, { R: 300, deg: 30 }, { R: 700, deg: 116 }, { R: 300, deg: 30 },
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

describe('142 kerbs post-coder gaps', () => {
  it('detectKerbs does not mutate its input', () => {
    for (const pts of [circle(100, 314), wrapMergeLoop()]) {
      const before = JSON.stringify(pts);
      detectKerbs(pts);
      expect(JSON.stringify(pts)).toBe(before);
    }
  });

  it('outside entry kerb switches strictly at 150 m: R 148 outside covers [start-20, end+20], R 152 outside is exit only [end-5, end+20]', () => {
    expect(detectKerbs(circle(148, 465))).toEqual([
      { start: 0, end: 464, side: 'left' },
      { start: 445, end: 19, side: 'right' }, // entry [445,5] and exit [459,19] merged
    ]);
    expect(detectKerbs(circle(152, 478))).toEqual([
      { start: 0, end: 477, side: 'left' },
      { start: 472, end: 19, side: 'right' }, // exit only: no entry paint at min radius >= 150
    ]);
  });

  it('same-side inside kerbs of two runs whose junction straddles index 0 merge into one wrapped kerb covering index 0', () => {
    const pts = wrapMergeLoop();
    const n = pts.length;
    expect(Math.hypot(pts[n - 1][0] - pts[0][0], pts[n - 1][1] - pts[0][1])).toBeLessThan(4); // fixture really closes
    const runs = cornerRuns(pts).filter((r) => w(r.end - r.start, n) + 1 >= 4);
    expect(runs).toHaveLength(4);
    for (const r of runs) expect(r.minRadius).toBeGreaterThanOrEqual(150); // no entry kerbs anywhere
    const side = runs[0].side;
    const kerbs = detectKerbs(pts);
    expect(kerbs.filter((k) => k.side === side)).toHaveLength(2); // 4 runs, 2 merges
    const outside = kerbs.filter((k) => k.side === opp(side));
    expect(outside).toHaveLength(4);
    for (const r of runs) {
      expect(outside.filter((k) => cdist(k.start, w(r.end - 5, n), n) <= 1 && cdist(k.end, w(r.end + 20, n), n) <= 1))
        .toHaveLength(1);
    }
    const wrapped = kerbs.filter((k) => k.side === side && k.end < k.start);
    expect(wrapped).toHaveLength(1);
    expect(covers(wrapped[0], 0, n)).toBe(true);
    const sorted = [...runs].sort((a, b) => a.start - b.start);
    const crossA = sorted[0]; // run following the wrap junction
    const crossB = sorted[sorted.length - 1]; // run preceding it
    expect(w(crossA.start - crossB.end, n)).toBeLessThanOrEqual(31); // inside kerbs touch across index 0
    expect(cdist(wrapped[0].start, w(crossB.start - 15, n), n)).toBeLessThanOrEqual(1);
    expect(cdist(wrapped[0].end, w(crossA.end + 15, n), n)).toBeLessThanOrEqual(1);
    for (const i of [w(crossB.start - 15, n), crossB.end, crossA.start, w(crossA.end + 15, n)]) {
      expect(covers(wrapped[0], i, n)).toBe(true);
    }
    expect(kerbs.map((k) => k.start)).toEqual([...kerbs.map((k) => k.start)].sort((a, b) => a - b));
  });

  it('corners.ts no longer references KERB_RADIUS and constants still exports it', () => {
    const src = readFileSync(new URL('../../../tools/track-builder/corners.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/KERB_RADIUS/);
    expect(KERB_RADIUS).toBe(250);
  });

  it('every regenerated public track stores exactly detectKerbs(centerline) and keeps centerline, elevation and pit unchanged', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const ids = readdirSync(join(ROOT, 'public', 'tracks'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      for (const key of ['centerline', 'elevation', 'pit'] as const) {
        expect(track[key], `${id}: ${key} changed`).toEqual(prev[key]);
      }
      expect(detectKerbs(track.centerline), `${id}: stored kerbs not a fresh detectKerbs build`).toEqual(track.kerbs);
    }
  }, 180_000);
});

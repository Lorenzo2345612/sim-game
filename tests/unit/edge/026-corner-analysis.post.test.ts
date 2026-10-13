import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectKerbs, detectRunoffs, radii } from '../../../tools/track-builder/corners';
import { CORNER_RADIUS, KERB_RADIUS } from '../../../src/core/constants';
import type { Point2 } from '../../../src/track/geo';
import type { RunoffSegment, Side, TrackSegment } from '../../../src/core/types';

function circle(R: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)]; // counter-clockwise: every point turns 'left'
  });
}

function stadium(R: number, arcSteps: number): Point2[] {
  const dA = Math.PI / arcSteps;
  const pts: Point2[] = [];
  for (let k = 0; k <= 100; k++) pts.push([2 * k, -R]);
  for (let j = 1; j < arcSteps; j++) { const u = j * dA; pts.push([200 + R * Math.sin(u), -R * Math.cos(u)]); }
  pts.push([200, R]);
  for (let k = 1; k <= 200; k++) pts.push([200 - 2 * k, R]);
  for (let j = 1; j < arcSteps; j++) { const v = j * dA; pts.push([-200 - R * Math.sin(v), R * Math.cos(v)]); }
  pts.push([-200, -R]);
  for (let k = 1; k < 100; k++) pts.push([-200 + 2 * k, -R]);
  return pts;
}

function manyCorners(nCorners: number, cornerR: number, straightLen: number): Point2[] {
  const pts: Point2[] = [];
  const arc = (2 * Math.PI) / nCorners;
  let x = 0, z = 0, h = 0;
  for (let c = 0; c < nCorners; c++) {
    for (let d = 0; d < straightLen - 0.001; d += 2) { pts.push([x, z]); x += 2 * Math.cos(h); z += 2 * Math.sin(h); }
    const steps = Math.max(1, Math.round((cornerR * arc) / 2));
    const dA = arc / steps;
    const cx = x - cornerR * Math.sin(h), cz = z + cornerR * Math.cos(h);
    for (let j = 0; j < steps; j++) {
      h += dA;
      const px = x - cx, pz = z - cz;
      x = cx + px * Math.cos(dA) - pz * Math.sin(dA);
      z = cz + px * Math.sin(dA) + pz * Math.cos(dA);
      pts.push([x, z]);
    }
  }
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  return pts;
}

function rot(pts: Point2[], shift: number): Point2[] {
  const n = pts.length;
  return Array.from({ length: n }, (_, i): Point2 => pts[(i + shift) % n]);
}

function rose(): Point2[] {
  const a = Math.sqrt(182500), b = 50, k = 6, n = 1400;
  return Array.from({ length: n }, (_, i): Point2 => {
    const th = (2 * Math.PI * i) / n;
    const r = a + b * Math.cos(k * th);
    return [r * Math.cos(th), -r * Math.sin(th)];
  });
}

// Closed loop whose two opposite-side arcs meet with no straight between them,
// so a qualifying point is directly followed by a qualifying point of the other side.
function kinkLoop(): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let x = 0, z = 0, h = 0;
  for (let j = 0; j < 50; j++) { x += 2; pts.push([x, z]); }
  const arc = (sign: number, len: number) => {
    for (let j = 0; j < len; j++) {
      x += 2 * Math.cos(h); z += 2 * Math.sin(h); h += sign * 0.02;
      pts.push([x, z]);
    }
  };
  arc(1, 14);
  arc(-1, 14);
  for (let j = 0; j < 200; j++) { x -= 2; z += 0.2; pts.push([x, z]); }
  return pts;
}

// Spec ground truth (task steps 3-6), independent of the implementation module.
function turnDir(pts: Point2[], i: number): Side | null {
  const n = pts.length;
  const w = (v: number) => ((v % n) + n) % n;
  const p = pts[w(i - 5)], c = pts[i], q = pts[w(i + 5)];
  const cr = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
  return cr < 0 ? 'left' : cr > 0 ? 'right' : null;
}

interface Run { start: number; end: number; side: Side; minRadius: number }

function specRuns(pts: Point2[], threshold: number): Run[] {
  const n = pts.length;
  if (n === 0) return [];
  const r = radii(pts);
  const sides = r.map((v, i) => (v < threshold ? turnDir(pts, i) : null));
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
    if (start >= 0) runs.push({ start, end: (i - 1 + n) % n, side: side as Side, minRadius });
    if (s !== null && r[i] < threshold) { start = i; side = s; minRadius = r[i]; }
    else { start = -1; side = null; minRadius = Infinity; }
  }
  if (start >= 0) runs.push({ start, end: (from + n - 1) % n, side: side as Side, minRadius });
  return runs;
}

const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');

function specKerbs(pts: Point2[]): TrackSegment[] {
  const n = pts.length;
  const out: TrackSegment[] = [];
  for (const run of specRuns(pts, KERB_RADIUS)) {
    if (((run.end - run.start + n) % n) + 1 < 8) continue;
    const end = (run.end + 10) % n;
    out.push({ start: (run.start - 10 + n) % n, end, side: run.side });
    out.push({ start: (end - 14 + n) % n, end, side: opp(run.side) });
  }
  return out;
}

function specRunoffs(pts: Point2[]): RunoffSegment[] {
  const n = pts.length;
  return specRuns(pts, CORNER_RADIUS)
    .filter(run => run.minRadius < 150) // 098: no run-off for corners at or above 150 m
    .map(run => {
      const end = (run.end + 15) % n;
      const gravel = run.minRadius < 100;
      return {
        start: (run.start - 15 + n) % n,
        end,
        side: opp(run.side),
        surface: gravel ? 'gravel' : 'runoff',
        widthMeters: gravel ? 18 : 12,
      };
    });
}

const canon = (segs: object[]): string[] =>
  [...segs].map(s => JSON.stringify(s)).sort();

function hasAdjacentFlip(pts: Point2[]): boolean {
  const n = pts.length;
  const r = radii(pts);
  const s = (i: number) => (r[i] < KERB_RADIUS ? turnDir(pts, i) : null);
  for (let i = 0; i < n; i++) {
    const a = s(i), b = s((i + 1) % n);
    if (a === 'left' && b === 'right' || a === 'right' && b === 'left') return true;
  }
  return false;
}

describe('026 corner analysis post-coder gaps', () => {
  it('empty centerline returns empty arrays without throwing', () => {
    expect(radii([])).toEqual([]);
    expect(detectKerbs([])).toEqual([]);
    expect(detectRunoffs([])).toEqual([]);
  });

  it('collinear loops of 1, 5 or 6 points and coincident-point loops give the 1e6 cap and no segments', () => {
    for (const n of [1, 5, 6]) {
      const pts = Array.from({ length: n }, (_, k): Point2 => [2 * k, 0]);
      const r = radii(pts);
      expect(r).toHaveLength(n);
      for (const v of r) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBe(1e6);
      }
      expect(detectKerbs(pts)).toEqual([]);
      expect(detectRunoffs(pts)).toEqual([]);
    }
    const coincident = Array.from({ length: 40 }, (): Point2 => [7, -3]);
    for (const v of radii(coincident)) expect(v).toBe(1e6);
    expect(detectKerbs(coincident)).toEqual([]);
    expect(detectRunoffs(coincident)).toEqual([]);
  });

  it('radii and detectors handle loops of 2-4 points without indexing outside [0, N)', () => {
    for (const n of [2, 3, 4]) {
      const pts = Array.from({ length: n }, (_, k): Point2 => [2 * k, 0]);
      const r = radii(pts); // throws TypeError today: (i - 5 + n) % n < 0 for small i
      expect(r).toHaveLength(n);
      for (const v of r) expect(v).toBe(1e6);
      expect(detectKerbs(pts)).toEqual([]);
      expect(detectRunoffs(pts)).toEqual([]);
    }
  });

  it('thresholds are strict: R = 450 loop is neither corner nor kerb, R = 260 gets no kerbs and no run-off (098)', () => {
    const wide = circle(450, 1414); // ~2 m spacing, radius >= CORNER_RADIUS (400)
    expect(detectKerbs(wide)).toEqual([]);
    expect(detectRunoffs(wide)).toEqual([]);
    const mid = circle(260, 817); // >= KERB_RADIUS (250), < CORNER_RADIUS, min radius >= 150
    expect(detectKerbs(mid)).toEqual([]);
    expect(detectRunoffs(mid)).toEqual([]); // 098: sweeper, no run-off
  });

  it('gravel/asphalt switch uses the run minimum radius against 150 m and 100 m', () => {
    const gravel = circle(90, 283);
    const paved = circle(140, 440);
    const loose = circle(160, 503);
    expect(detectRunoffs(gravel)).toEqual([
      { start: expect.any(Number), end: expect.any(Number), side: 'right', surface: 'gravel', widthMeters: 18 },
    ]);
    expect(detectRunoffs(paved)).toEqual([
      { start: expect.any(Number), end: expect.any(Number), side: 'right', surface: 'runoff', widthMeters: 12 },
    ]);
    expect(detectRunoffs(loose)).toEqual([]); // 098: min radius >= 150, no run-off
  });

  it('all-qualifying loop is one run anchored at index 0 with exact extension bounds', () => {
    const pts = circle(100, 314);
    expect(detectKerbs(pts)).toEqual([
      { start: 304, end: 9, side: 'left' }, // inside: 0-10 .. 313+10, wrapped
      { start: 309, end: 9, side: 'right' }, // exit: last 15 points of the extended run
    ]);
    expect(detectRunoffs(pts)).toEqual([
      { start: 299, end: 14, side: 'right', surface: 'gravel', widthMeters: 18 },
    ]);
  });

  it('every index is an integer in [0, N) and segments are sorted by start for all fixtures and rotations', () => {
    const fixtures = [stadium(80, 126), stadium(300, 471), circle(100, 314), manyCorners(50, 3, 20)];
    for (const base of fixtures) {
      const n = base.length;
      for (const shift of [0, 1, 7, Math.floor(n / 2), n - 1]) {
        const pts = rot(base, shift);
        const lists: TrackSegment[][] = [detectKerbs(pts), detectRunoffs(pts)];
        for (const segs of lists) {
          for (const s of segs) {
            expect(Number.isInteger(s.start)).toBe(true);
            expect(Number.isInteger(s.end)).toBe(true);
            expect(s.start).toBeGreaterThanOrEqual(0);
            expect(s.start).toBeLessThan(n);
            expect(s.end).toBeGreaterThanOrEqual(0);
            expect(s.end).toBeLessThan(n);
          }
          expect(segs.map(s => s.start)).toEqual([...segs.map(s => s.start)].sort((a, b) => a - b));
        }
        if (detectKerbs(base).length > 0) { // stadium(300) has no kerbs and, since 098, no run-offs
          expect(detectKerbs(pts).length + detectRunoffs(pts).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('corners.ts is pure: no three or Node API usage in the module source', () => {
    const src = readFileSync(new URL('../../../tools/track-builder/corners.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/from\s+['"]node:/);
    expect(src).not.toMatch(/from\s+['"](fs|path|os|crypto|util|net|http|https|dns)['"]/);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/\bprocess\./);
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/);
  });

  it('the kerb minimum run length is exactly 8: a loop of 8 qualifying points gets a kerb pair, a loop of 7 gets none but keeps its run-off', () => {
    const eight = detectKerbs(circle(100, 8));
    expect(eight).toHaveLength(2);
    expect(new Set(eight.map(k => k.side))).toEqual(new Set<TrackSegment['side']>(['left', 'right']));
    expect(eight[0].end).toBe(eight[1].end); // inside and exit kerb of the same run share their end
    const seven = detectKerbs(circle(100, 7));
    expect(seven).toEqual([]);
    for (const n of [7, 8]) {
      const runoff = detectRunoffs(circle(100, n));
      expect(runoff).toHaveLength(1); // no minimum length applies to run-offs
      expect(runoff[0].start).toBeGreaterThanOrEqual(0);
      expect(runoff[0].start).toBeLessThan(n);
      expect(runoff[0].end).toBeGreaterThanOrEqual(0);
      expect(runoff[0].end).toBeLessThan(n);
    }
  });

  it('threshold comparisons are strict near the constants: 248 gets kerbs but 252 none, 398 and 402 get no run-off, 148 is paved but 152 none (098)', () => {
    expect(detectKerbs(circle(248, 777))).toHaveLength(2);
    expect(detectRunoffs(circle(248, 777))).toEqual([]); // 098: min radius >= 150
    expect(detectKerbs(circle(252, 792))).toEqual([]);
    expect(detectRunoffs(circle(252, 792))).toEqual([]);
    expect(detectRunoffs(circle(398, 1250))).toEqual([]);
    expect(detectRunoffs(circle(402, 1263))).toEqual([]);
    expect(detectKerbs(circle(402, 1263))).toEqual([]);
    const tight = detectRunoffs(circle(148, 465));
    expect(tight).toHaveLength(1); // 098: below 150 keeps a run-off
    expect(tight[0].surface).toBe('runoff'); // but 148 >= 100, so paved
    expect(tight[0].widthMeters).toBe(12);
    expect(detectRunoffs(circle(152, 478))).toEqual([]); // 098: min radius >= 150
  });

  it('a loop whose turning side flips with no straight between the arcs splits into two runs, one kerb pair each', () => {
    const pts = kinkLoop();
    const n = pts.length;
    expect(hasAdjacentFlip(pts)).toBe(true); // fixture really exercises the side-change split
    const kerbs = detectKerbs(pts);
    expect(canon(kerbs)).toEqual(canon(specKerbs(pts)));
    expect(canon(detectRunoffs(pts))).toEqual(canon(specRunoffs(pts)));
    expect(kerbs).toHaveLength(6); // three runs (right, left, right), one inside + one exit each
    expect(detectRunoffs(pts)).toHaveLength(3);
    const span = (s: TrackSegment) => ((s.end - s.start + n) % n) + 1;
    const inside = kerbs.filter(k => span(k) > 15);
    const overlap = inside.some((a, i) =>
      inside.slice(i + 1).some(b => a.side !== b.side &&
        (b.start >= a.start && b.start <= a.end || a.start >= b.start && a.start <= b.end)));
    expect(overlap).toBe(true); // the two opposite-side inside kerbs share points around the flip
  });

  it('a mixed-side loop with several corners yields one inside plus one exit kerb per qualifying run and one run-off per run, including a wrapped segment', () => {
    const pts = rose();
    const kerbs = detectKerbs(pts);
    const runoff = detectRunoffs(pts);
    expect(canon(kerbs)).toEqual(canon(specKerbs(pts)));
    expect(canon(runoff)).toEqual(canon(specRunoffs(pts)));
    expect(kerbs.length % 2).toBe(0);
    expect(kerbs.length / 2).toBeGreaterThanOrEqual(6); // at least 6 separate corner runs
    expect(kerbs.filter(k => k.end < k.start).length).toBeGreaterThanOrEqual(1); // one spans index 0
    for (const side of ['left', 'right'] as const) {
      expect(kerbs.some(k => k.side === side)).toBe(true);
    }
    expect(runoff.length).toBe(kerbs.length / 2);
    expect(runoff.every(s => s.surface === 'runoff' && s.widthMeters === 12)).toBe(true); // 098: every run min radius in [100, 150)
  });

  it('segment indices shift exactly with a rotation of the input on every non-degenerate fixture', () => {
    const sweeper = stadium(300, 471); // no kerbs and, since 098, no run-offs
    expect(detectKerbs(sweeper)).toEqual([]);
    expect(detectRunoffs(sweeper)).toEqual([]);
    const fixtures = [stadium(80, 126), manyCorners(50, 3, 20), rose(), kinkLoop()];
    for (const base of fixtures) {
      const n = base.length;
      const k0 = detectKerbs(base);
      const r0 = detectRunoffs(base);
      expect(k0.length + r0.length).toBeGreaterThan(0);
      for (const shift of [1, 5, n - 1, Math.floor(n / 2)]) {
        const w = (v: number) => ((v - shift) % n + n) % n;
        const moved = (segs: TrackSegment[]) =>
          segs.map(s => ({ ...s, start: w(s.start), end: w(s.end) }));
        expect(canon(detectKerbs(rot(base, shift)))).toEqual(canon(moved(k0)));
        expect(canon(detectRunoffs(rot(base, shift)))).toEqual(canon(moved(r0)));
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, Side } from '../../../src/core/types';
import { detectCorners } from '../../../tools/track-builder/corners';
import type { CornerRun } from '../../../tools/track-builder/corners';
import {
  applyFoamBarriers,
  applyPavedRunoffs,
  classifyCorners,
  detectEscapeRoads,
} from '../../../tools/track-builder/hazards';
import type { BrakingCorner } from '../../../tools/track-builder/hazards';
import { parseTrackData } from '../../../src/track/parseTrackData';

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const corner = (
  start: number, end: number, side: Side, minRadius: number, dropKmh: number,
  kind: BrakingCorner['kind'],
): BrakingCorner => ({ start, end, side, minRadius, dropKmh, kind });
const line = (n: number): Point2[] =>
  Array.from({ length: n }, (_, i): Point2 => [2 * i, 0]);

// Forward arc length between indices, wrapping through the closing edge.
function arcLen(points: Point2[], a: number, b: number): number {
  const n = points.length;
  let d = 0;
  for (let i = a; i !== b; i = (i + 1) % n) {
    const j = (i + 1) % n;
    d += Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
  }
  return d;
}

// Rounded square: 4 straights of `straight` m + 4 quarter arcs of radius R, ~2 m spacing.
function roundedSquare(R: number, straight: number): Point2[] {
  const L = straight + 2 * R;
  const k = Math.round(straight / 2);
  const pts: Point2[] = [];
  const arc = (cx: number, cz: number, a0: number): void => {
    const m = Math.round(((Math.PI / 2) * R) / 2);
    for (let j = 1; j <= m; j++) {
      const a = ((a0 + (90 * j) / m) * Math.PI) / 180;
      pts.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]);
    }
  };
  for (let i = 1; i <= k; i++) pts.push([R + 2 * i, 0]);
  arc(L - R, R, -90);
  for (let i = 1; i <= k; i++) pts.push([L, R + 2 * i]);
  arc(L - R, L - R, 0);
  for (let i = 1; i <= k; i++) pts.push([L - R - 2 * i, L]);
  arc(R, L - R, 90);
  for (let i = 1; i <= k; i++) pts.push([0, L - R - 2 * i]);
  arc(R, R, 180);
  return pts;
}

// Closed stadium, 535 m straights, corner arcs alternating R15 / R250, all turning right.
function stadiumFixture(): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let px = 0;
  let pz = 0;
  let phi = 0;
  const straight = (m: number): void => {
    let d = m;
    while (d > 1e-9) {
      const s = Math.min(2, d);
      d -= s;
      px += s * Math.cos(phi);
      pz += s * Math.sin(phi);
      pts.push([px, pz]);
    }
  };
  const arc = (R: number, deg: number, s: number): void => {
    const span = (deg * Math.PI) / 180;
    const k = Math.max(1, Math.ceil((R * span) / 2));
    const cx = px + s * R * -Math.sin(phi);
    const cz = pz + s * R * Math.cos(phi);
    const vx = px - cx;
    const vz = pz - cz;
    for (let j = 1; j <= k; j++) {
      const th = (s * span * j) / k;
      px = cx + vx * Math.cos(th) - vz * Math.sin(th);
      pz = cz + vx * Math.sin(th) + vz * Math.cos(th);
      pts.push([px, pz]);
    }
    phi += s * span;
  };
  straight(535); arc(15, 90, 1);
  straight(535); arc(250, 90, 1);
  straight(535); arc(15, 90, 1);
  straight(535); arc(250, 90, 1);
  if (Math.hypot(px, pz) < 1e-6) pts.pop();
  return pts;
}

// AT3-style chicane: 500 m straight, left R40 60 deg, `mid` straight, right R40 60 deg,
// 500 m straight, closed by a loop of R300 quarter arcs.
function chicaneFixture(mid: number): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let px = 0;
  let pz = 0;
  let phi = -Math.PI / 2;
  const straight = (m: number): void => {
    let d = m;
    while (d > 1e-9) {
      const s = Math.min(2, d);
      d -= s;
      px += s * Math.cos(phi);
      pz += s * Math.sin(phi);
      pts.push([px, pz]);
    }
  };
  const arc = (R: number, deg: number, s: number): void => {
    const span = (deg * Math.PI) / 180;
    const k = Math.max(1, Math.ceil((R * span) / 2));
    const cx = px + s * R * -Math.sin(phi);
    const cz = pz + s * R * Math.cos(phi);
    const vx = px - cx;
    const vz = pz - cz;
    for (let j = 1; j <= k; j++) {
      const th = (s * span * j) / k;
      px = cx + vx * Math.cos(th) - vz * Math.sin(th);
      pz = cz + vx * Math.sin(th) + vz * Math.cos(th);
      pts.push([px, pz]);
    }
    phi += s * span;
  };
  straight(500); arc(40, 60, -1); straight(mid); arc(40, 60, 1); straight(500);
  const phi0 = phi;
  const dx = -px;
  const dz = -pz;
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  arc(300, 90, 1); straight(Math.max(along(phi0 + Math.PI / 2), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + Math.PI), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + (3 * Math.PI) / 2), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + 2 * Math.PI), 0));
  if (Math.hypot(px, pz) < 1e-6) pts.pop();
  return pts;
}

// Spec step 1 kind bands.
function expectedKind(c: BrakingCorner): BrakingCorner['kind'] {
  if (c.dropKmh >= 70 && c.minRadius < 120) return 'heavy';
  if (c.dropKmh >= 70) return c.minRadius < 150 ? 'medium' : 'none';
  return c.dropKmh >= 40 ? 'medium' : 'none';
}

function checkFixture(pts: Point2[], kinds: BrakingCorner['kind'][]): void {
  const runs = detectCorners(pts).slice().sort((a: CornerRun, b: CornerRun) => a.start - b.start);
  const corners = classifyCorners(pts);
  expect(corners).toHaveLength(runs.length);
  expect(corners.map((c: BrakingCorner) => c.kind)).toEqual(kinds);
  for (const c of corners) {
    const rk = runs.findIndex((r: CornerRun) => r.start === c.start);
    expect(rk, `run for corner start ${c.start}`).toBeGreaterThanOrEqual(0);
    const run = runs[rk];
    expect(c.end).toBe(run.end);
    expect(c.side).toBe(run.side);
    expect(c.minRadius).toBeCloseTo(run.minRadius, 9);
    const prev = runs[(rk - 1 + runs.length) % runs.length];
    const L = arcLen(pts, prev.end, run.start);
    const vc = Math.min(85, Math.sqrt(1.6 * 9.81 * c.minRadius));
    const ap = Math.min(85, Math.sqrt(vc * vc + 2 * 12 * L));
    expect(c.dropKmh).toBeCloseTo(3.6 * (ap - vc), 6);
    expect(expectedKind(c)).toBe(c.kind);
  }
}

describe('140 edge: paved run-offs, foam, classify, escape roads, parser', () => {
  it('EDGE1: applyPavedRunoffs adds one runoff on the outside with exact inclusive span start-25..end+10 and width 10+0.1*dropKmh', () => {
    const out = applyPavedRunoffs(line(200), [], [corner(100, 140, 'left', 100, 80, 'heavy')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      start: 75, end: 150, side: 'right', surface: 'runoff', widthMeters: expect.any(Number),
    });
    expect(out[0].widthMeters).toBeCloseTo(18, 9);
  });

  it('EDGE2: applyPavedRunoffs removes only overlapping runoffs on the outside side, span bounds inclusive', () => {
    const beforeSpan: RunoffSegment = { start: 10, end: 14, side: 'right', surface: 'gravel', widthMeters: 12 };
    const touchesStart: RunoffSegment = { start: 11, end: 15, side: 'right', surface: 'gravel', widthMeters: 12 };
    const touchesEnd: RunoffSegment = { start: 70, end: 74, side: 'right', surface: 'runoff', widthMeters: 12 };
    const afterSpan: RunoffSegment = { start: 71, end: 75, side: 'right', surface: 'gravel', widthMeters: 12 };
    const inside: RunoffSegment = { start: 15, end: 70, side: 'left', surface: 'gravel', widthMeters: 12 };
    const input = [beforeSpan, touchesStart, touchesEnd, afterSpan, inside];
    const out = applyPavedRunoffs(line(200), input, [corner(40, 60, 'left', 90, 80, 'heavy')]);
    expect(out).toHaveLength(4);
    expect(out).toContainEqual(beforeSpan);
    expect(out).toContainEqual(afterSpan);
    expect(out).toContainEqual(inside);
    expect(out).toContainEqual({
      start: 15, end: 70, side: 'right', surface: 'runoff', widthMeters: expect.any(Number),
    });
    expect(out.some((r) => r.start === 11 && r.end === 15)).toBe(false);
    expect(out.some((r) => r.start === 70 && r.end === 74)).toBe(false);
    const starts = out.map((r) => r.start);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1]);
  });

  it('EDGE3: applyPavedRunoffs wraps start-25/end+10 with positive modulo, returns a new sorted array and does not mutate the input', () => {
    const input: RunoffSegment[] = [
      { start: 85, end: 95, side: 'right', surface: 'gravel', widthMeters: 12 },
    ];
    const snapshot = JSON.stringify(input);
    const out = applyPavedRunoffs(line(100), input, [
      corner(5, 20, 'left', 110, 80, 'heavy'),
      corner(40, 55, 'right', 100, 100, 'heavy'),
    ]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.start)).toEqual([15, 80]);
    expect(out[0]).toEqual({ start: 15, end: 65, side: 'left', surface: 'runoff', widthMeters: expect.any(Number) });
    expect(out[0].widthMeters).toBeCloseTo(20, 9);
    expect(out[1]).toEqual({ start: 80, end: 30, side: 'right', surface: 'runoff', widthMeters: expect.any(Number) });
    expect(out[1].widthMeters).toBeCloseTo(18, 9);
  });

  it('EDGE4: paved width is clamp(10+0.1*dropKmh,10,30) rounded to 0.5 and only heavy corners add pavement', () => {
    const out = applyPavedRunoffs(line(300), [], [
      corner(40, 60, 'left', 100, 70, 'heavy'),
      corner(140, 180, 'right', 100, 100, 'heavy'),
      corner(240, 260, 'left', 100, 1000, 'heavy'),
      corner(110, 125, 'right', 60, 200, 'medium'),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.start)).toEqual([15, 115, 215]);
    expect(out.map((r) => r.side)).toEqual(['right', 'left', 'right']);
    [17, 20, 30].forEach((w, i) => expect(out[i].widthMeters).toBeCloseTo(w, 9));
  });

  it('EDGE5: medium corner foams only outside barriers with offsetMeters < 20 (20 excluded), splitting a wrapped barrier segment at the span bounds', () => {
    const b1: BarrierSegment = { start: 86, end: 15, side: 'right', type: 'armco', offsetMeters: 19.5 };
    const b2: BarrierSegment = { start: 16, end: 28, side: 'right', type: 'wall', offsetMeters: 20 };
    const b3: BarrierSegment = { start: 31, end: 40, side: 'right', type: 'armco', offsetMeters: 19.5 };
    const b4: BarrierSegment = { start: 0, end: 25, side: 'left', type: 'armco', offsetMeters: 9 };
    const out = applyFoamBarriers([b1, b2, b3, b4], [corner(5, 20, 'left', 60, 50, 'medium')]);
    expect(out).toHaveLength(5);
    expect(out.filter((b) => b.type === 'foam')).toHaveLength(1);
    expect(out).toContainEqual({ start: 90, end: 15, side: 'right', type: 'foam', offsetMeters: 19.5 });
    expect(out).toContainEqual({ ...b1, end: 89 });
    expect(out).toContainEqual(b2);
    expect(out).toContainEqual(b3);
    expect(out).toContainEqual(b4);
  });

  it('EDGE6: applyFoamBarriers re-merges adjacent equal-type equal-offset segments across the heavy span, keeps offsets and does not mutate the input', () => {
    const barriers: BarrierSegment[] = [
      { start: 25, end: 40, side: 'right', type: 'armco', offsetMeters: 9 },
      { start: 41, end: 55, side: 'right', type: 'armco', offsetMeters: 9 },
      { start: 56, end: 70, side: 'right', type: 'wall', offsetMeters: 9 },
      { start: 71, end: 75, side: 'right', type: 'armco', offsetMeters: 19.5 },
      { start: 80, end: 90, side: 'right', type: 'wall', offsetMeters: 12 },
      { start: 91, end: 100, side: 'right', type: 'armco', offsetMeters: 9 },
      { start: 25, end: 70, side: 'left', type: 'armco', offsetMeters: 9 },
    ];
    const snapshot = JSON.stringify(barriers);
    const out = applyFoamBarriers(barriers, [corner(40, 60, 'left', 50, 80, 'heavy')]);
    expect(JSON.stringify(barriers)).toBe(snapshot);
    expect(out).toHaveLength(5);
    const foam = out.filter((b) => b.type === 'foam');
    expect(foam).toHaveLength(1);
    expect(foam[0]).toEqual({ start: 25, end: 70, side: 'right', type: 'foam', offsetMeters: 9 });
    expect(out).toContainEqual({ ...barriers[3], type: 'armco' });
    expect(out).toContainEqual({ ...barriers[4], type: 'wall' });
    expect(out).toContainEqual({ ...barriers[5], type: 'armco' });
    expect(out).toContainEqual({ ...barriers[6], type: 'armco' });
  });

  it('EDGE7: classifyCorners dropKmh matches the spec formulas with 85 m/s caps and km/h conversion, and kinds follow the heavy/medium/none bands', () => {
    checkFixture(roundedSquare(60, 50), ['medium', 'medium', 'medium', 'medium']);
    checkFixture(roundedSquare(130, 240), ['medium', 'medium', 'medium', 'medium']);
    // radius-band medium: drop >= 70 with 120 <= minRadius < 150
    for (const c of classifyCorners(roundedSquare(130, 240))) {
      expect(c.dropKmh).toBeGreaterThanOrEqual(70);
      expect(c.minRadius).toBeGreaterThanOrEqual(120);
      expect(c.minRadius).toBeLessThan(150);
    }
    const stadium = stadiumFixture();
    checkFixture(stadium, ['heavy', 'none', 'heavy', 'none']);
    const heavy = classifyCorners(stadium).filter((c: BrakingCorner) => c.kind === 'heavy');
    expect(heavy).toHaveLength(2);
    for (const c of heavy) {
      const vc = Math.min(85, Math.sqrt(1.6 * 9.81 * c.minRadius));
      expect(vc).toBeLessThan(85);
      // the long approach means the 85 m/s cap on the approach speed is what binds
      expect(c.dropKmh).toBeCloseTo(3.6 * (85 - vc), 6);
    }
  });

  it('EDGE8: detectEscapeRoads ignores an opposite-side tight pair whose gap is at least 120 m', () => {
    const pts = chicaneFixture(300);
    const runs = detectCorners(pts).slice().sort((a: CornerRun, b: CornerRun) => a.start - b.start);
    expect(runs[0].side).not.toBe(runs[1].side);
    expect(runs[0].minRadius).toBeLessThan(80);
    expect(runs[1].minRadius).toBeLessThan(80);
    expect(arcLen(pts, runs[0].end, runs[1].start)).toBeGreaterThanOrEqual(120);
    expect(detectEscapeRoads(pts)).toHaveLength(0);
  });

  it('EDGE9: escape road polyline is A->K->B sampled every <=2 m with exact leg ends, A first, B last and K appearing once', () => {
    const pts = chicaneFixture(50);
    const runs = detectCorners(pts).slice().sort((a: CornerRun, b: CornerRun) => a.start - b.start);
    const n = pts.length;
    const aIdx = wrap(runs[0].start - 10, n);
    const A = pts[aIdx];
    const B = pts[runs[1].end];
    const prev = pts[wrap(aIdx - 1, n)];
    const next = pts[wrap(aIdx + 1, n)];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    const T: Point2 = [(next[0] - prev[0]) / len, (next[1] - prev[1]) / len];
    const dot = (B[0] - A[0]) * T[0] + (B[1] - A[1]) * T[1];
    const K: Point2 = [A[0] + T[0] * dot, A[1] + T[1] * dot];

    const roads = detectEscapeRoads(pts);
    expect(roads).toHaveLength(1);
    const p = roads[0].points;
    expect(p.length).toBeGreaterThanOrEqual(4);
    expect(dist(p[0], A)).toBeLessThanOrEqual(1e-6);
    expect(dist(p[p.length - 1], B)).toBeLessThanOrEqual(1e-6);
    for (let i = 1; i < p.length; i++) {
      const d = dist(p[i], p[i - 1]);
      expect(d).toBeGreaterThan(1e-9);
      expect(d).toBeLessThanOrEqual(2 + 1e-6);
    }
    const nearK = p.map((q, i) => ({ i, d: dist(q, K) })).filter((x) => x.d <= 1e-6);
    expect(nearK).toHaveLength(1);
    const kIdx = nearK[0].i;
    const lineDist = (q: [number, number], o: [number, number], dir: [number, number]): number => {
      const dl = Math.hypot(dir[0], dir[1]);
      return Math.abs((q[0] - o[0]) * (dir[1] / dl) - (q[1] - o[1]) * (dir[0] / dl));
    };
    for (let i = 0; i < kIdx; i++) {
      expect(lineDist(p[i], A, T), `point ${i} off leg A-K`).toBeLessThanOrEqual(1e-4);
    }
    for (let i = kIdx + 1; i < p.length; i++) {
      expect(lineDist(p[i], K, [B[0] - K[0], B[1] - K[1]]), `point ${i} off leg K-B`).toBeLessThanOrEqual(1e-4);
    }
  });

  it('EDGE10: parseTrackData throws on non-object input and on a barrier type outside armco/tyres/wall/foam', () => {
    expect(() => parseTrackData(null)).toThrow();
    expect(() => parseTrackData(undefined)).toThrow();
    expect(() => parseTrackData('not a track')).toThrow();
    expect(() => parseTrackData(42)).toThrow();
    expect(() =>
      parseTrackData({
        version: 2,
        barriers: [{ start: 0, end: 3, side: 'left', type: 'concrete', offsetMeters: 12 }],
      }),
    ).toThrow();
  });
});

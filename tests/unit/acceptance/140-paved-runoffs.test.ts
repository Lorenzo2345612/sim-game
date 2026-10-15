import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectCorners, detectKerbs, detectRunoffs } from '../../../tools/track-builder/corners';
import {
  applyFoamBarriers,
  applyPavedRunoffs,
  classifyCorners,
  detectEscapeRoads,
} from '../../../tools/track-builder/hazards';
import { layoutBarriers } from '../../../tools/track-builder/barriers';
import { parseTrackData } from '../../../src/track/parseTrackData';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, Side, TrackDataV2 } from '../../../src/core/types';

// Mirrors task 140's EscapeRoad / TrackDataV2.escapeRoads so this test-first file
// also type-checks until types.ts is updated.
interface EscapeRoad140 {
  points: [number, number][];
  width: number;
}
type TrackV2_140 = TrackDataV2 & { escapeRoads?: EscapeRoad140[] };
// Mirrors task 140's BrakingCorner (CornerRun + dropKmh + kind).
interface BrakingCorner140 {
  start: number;
  end: number;
  side: Side;
  minRadius: number;
  dropKmh: number;
  kind: 'heavy' | 'medium' | 'none';
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const cdist = (a: number, b: number, n: number) => Math.min(wrap(a - b, n), wrap(b - a, n));
const inRange = (seg: { start: number; end: number }, i: number, n: number) =>
  wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);
const isFoam = (b: { type: string }) => b.type === 'foam';

function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
  n: number,
): boolean {
  const len = wrap(b.end - b.start, n);
  for (let k = 0; k <= len; k++) {
    if (inRange(a, wrap(b.start + k, n), n)) return true;
  }
  return false;
}

// Rounded square: 4 straights of 600 m + 4 quarter-circle arcs of radius R, ~2 m spacing.
function roundedSquare(R: number): Point2[] {
  const L = 600 + 2 * R;
  const pts: Point2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    const k = Math.round(((Math.PI / 2) * R) / 2);
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

// AT3 fixture: 500 m straight along -Z, left arc R 40 (60 deg), 50 m straight,
// right arc R 40 (60 deg), 500 m straight, closed by a loop of R 300 quarter arcs.
function chicaneFixture(): Point2[] {
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
  straight(500);
  arc(40, 60, -1);
  straight(50);
  arc(40, 60, 1);
  straight(500);
  const phi0 = phi;
  const dx = -px;
  const dz = -pz;
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + (3 * Math.PI) / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + 2 * Math.PI), 0));
  if (Math.hypot(px, pz) < 1e-6) pts.pop(); // closing point already at the start
  return pts;
}

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['monza', 'spa', 'silverstone'];

function loadTrack(id: string): TrackV2_140 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackV2_140;
}

function cumulative(points: Point2[]): number[] {
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return cum;
}

function nearestIndex(points: Point2[], p: Point2): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - p[0], points[i][1] - p[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

describe('140 paved run-offs, escape roads and foam barriers acceptance', () => {
  it('AT1: rounded square with 600 m straights and R 30 arcs gives exactly 4 outside paved run-offs of width 30 spanning start-25..end+10 and outside barriers foam over start-15..end+10', () => {
    const pts = roundedSquare(30);
    const n = pts.length;
    const kerbs = detectKerbs(pts);
    const corners = classifyCorners(pts);
    const heavy = corners.filter((c: BrakingCorner140) => c.kind === 'heavy');
    expect(heavy).toHaveLength(4);
    const paved = applyPavedRunoffs(pts, detectRunoffs(pts, [], 6, kerbs), corners);
    expect(paved).toHaveLength(4);
    expect(paved.every((r: RunoffSegment) => r.surface === 'runoff')).toBe(true);
    for (const h of heavy) {
      const seg = paved.filter(
        (r: RunoffSegment) =>
          r.side === opp(h.side) &&
          cdist(r.start, wrap(h.start - 25, n), n) <= 1 &&
          cdist(r.end, wrap(h.end + 10, n), n) <= 1,
      );
      expect(seg).toHaveLength(1);
      expect(seg[0].widthMeters).toBeCloseTo(30, 9);
    }
    const foam = applyFoamBarriers(layoutBarriers(pts, 12, kerbs, paved), corners);
    for (const b of foam) {
      if (isFoam(b)) expect(heavy.some((h: BrakingCorner140) => opp(h.side) === b.side), `foam on side ${b.side}`).toBe(true);
    }
    for (const h of heavy) {
      const from = wrap(h.start - 15, n);
      const span = wrap(h.end + 10 - from, n);
      for (let k = 0; k <= span; k++) {
        const i = wrap(from + k, n);
        expect(
          foam.some((b: BarrierSegment) => isFoam(b) && b.side === opp(h.side) && inRange(b, i, n)),
          `index ${i} outside not foam`,
        ).toBe(true);
      }
    }
  });

  it('AT2: rounded square with R 200 arcs gives no paved run-off and no foam', () => {
    const pts = roundedSquare(200);
    const kerbs = detectKerbs(pts);
    const corners = classifyCorners(pts);
    const paved = applyPavedRunoffs(pts, detectRunoffs(pts, [], 6, kerbs), corners);
    expect(paved.filter((r: RunoffSegment) => r.surface === 'runoff')).toHaveLength(0);
    const foam = applyFoamBarriers(layoutBarriers(pts, 12, kerbs, paved), corners);
    expect(foam.filter((b: BarrierSegment) => isFoam(b))).toHaveLength(0);
  });

  it('AT3: chicane fixture gives exactly one escape road of width 8, first point 1 m from the centerline point 10 samples before the left arc, last point 1 m from the right arc end and the leg before K on the approach straight line', () => {
    const pts = chicaneFixture();
    const n = pts.length;
    const runs = detectCorners(pts);
    expect(runs[0].side).not.toBe(runs[1].side);
    const roads = detectEscapeRoads(pts);
    expect(roads).toHaveLength(1);
    const road = roads[0];
    expect(road.width).toBeCloseTo(8, 9);
    const aIdx = wrap(runs[0].start - 10, n);
    const A = pts[aIdx];
    const B = pts[runs[1].end];
    expect(Math.hypot(road.points[0][0] - A[0], road.points[0][1] - A[1]), 'first point within 1 m of A').toBeLessThanOrEqual(1);
    const last = road.points[road.points.length - 1];
    expect(Math.hypot(last[0] - B[0], last[1] - B[1]), 'last point within 1 m of B').toBeLessThanOrEqual(1);
    // K: projection of B onto the unit tangent at A (central difference, as rightNormal)
    const prev = pts[wrap(aIdx - 1, n)];
    const next = pts[wrap(aIdx + 1, n)];
    const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
    const tx = (next[0] - prev[0]) / len;
    const tz = (next[1] - prev[1]) / len;
    const dot = (B[0] - A[0]) * tx + (B[1] - A[1]) * tz;
    const kx = A[0] + tx * dot;
    const kz = A[1] + tz * dot;
    let kIdx = 0;
    let best = Infinity;
    road.points.forEach((p: [number, number], i: number) => {
      const d = Math.hypot(p[0] - kx, p[1] - kz);
      if (d < best) {
        best = d;
        kIdx = i;
      }
    });
    for (let i = 0; i <= kIdx; i++) {
      const p = road.points[i];
      const d = Math.abs((p[0] - A[0]) * tz - (p[1] - A[1]) * tx);
      expect(d, `point ${i} off the approach straight line`).toBeLessThanOrEqual(0.5);
    }
  });

  it('AT4: rebuilt monza has >= 2 paved run-offs matching the heavy rule, >= 1 escape road starting within the first 1500 m and >= 1 foam barrier segment', () => {
    const track = loadTrack('monza');
    const n = track.centerline.length;
    const heavy = classifyCorners(track.centerline).filter((c: BrakingCorner140) => c.kind === 'heavy');
    let matched = 0;
    for (const h of heavy) {
      if (
        track.runoffs.some(
          (r) =>
            r.surface === 'runoff' &&
            r.side === opp(h.side) &&
            cdist(r.start, wrap(h.start - 25, n), n) <= 1 &&
            cdist(r.end, wrap(h.end + 10, n), n) <= 1 &&
            r.widthMeters >= 17,
        )
      )
        matched++;
    }
    expect(matched).toBeGreaterThanOrEqual(2);
    const cum = cumulative(track.centerline);
    const roads = track.escapeRoads ?? [];
    expect(roads.length).toBeGreaterThanOrEqual(1);
    expect(roads.some((e) => cum[nearestIndex(track.centerline, e.points[0])] <= 1500)).toBe(true);
    expect(track.barriers.some((b) => isFoam(b))).toBe(true);
  });

  it('AT5: rebuilt monza/spa/silverstone keep centerline, elevation, kerbs and pit identical to the previous JSON and keep gravel outside heavy spans identical', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const keptGravel = (
      runoffs: RunoffSegment[],
      spans: { start: number; end: number; side: Side }[],
      n: number,
    ) =>
      runoffs.filter(
        (g) => g.surface === 'gravel' && !spans.some((h) => h.side === g.side && rangesOverlap(g, h, n)),
      );
    for (const id of IDS) {
      const track = loadTrack(id);
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackV2_140;
      for (const key of ['centerline', 'elevation', 'kerbs'] as const) {
        expect(track[key], `${id}: ${key} changed`).toEqual(prev[key]);
      }
      const n = track.centerline.length;
      const spans = classifyCorners(track.centerline)
        .filter((c: BrakingCorner140) => c.kind === 'heavy')
        .map((c: BrakingCorner140) => ({ side: opp(c.side), start: wrap(c.start - 25, n), end: wrap(c.end + 10, n) }));
      expect(keptGravel(track.runoffs, spans, n), `${id}: kept gravel changed`).toEqual(
        keptGravel(prev.runoffs, spans, n),
      );
    }
  }, 120000);

  it('AT6: parseTrackData defaults escapeRoads to [] and accepts a barrier of type foam', () => {
    const noEscape = parseTrackData({
      version: 2,
      barriers: [{ start: 0, end: 3, side: 'left', type: 'armco', offsetMeters: 12 }],
    }) as TrackV2_140;
    expect(noEscape.escapeRoads).toEqual([]);
    const withFoam = parseTrackData({
      version: 2,
      barriers: [{ start: 0, end: 3, side: 'left', type: 'foam', offsetMeters: 12 }],
    }) as TrackV2_140;
    expect(withFoam.barriers[0].type as string).toBe('foam');
  });
});

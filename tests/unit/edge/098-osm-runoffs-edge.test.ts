import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRunoffs as detectRunoffsImpl } from '../../../tools/track-builder/corners';
import { loadGravelPolygons } from '../../../tools/track-builder/osmAreas';
import { projectLonLat, type Point2 } from '../../../src/track/geo';
import type { RunoffSegment, Side, TrackSegment } from '../../../src/core/types';

// Spec-098 signature; typed locally so this test-first file compiles against the current 1-arg implementation.
type DetectRunoffs = (points: Point2[], gravel?: Point2[][], halfWidth?: number, kerbs?: TrackSegment[]) => RunoffSegment[];
const detectRunoffs = detectRunoffsImpl as DetectRunoffs;

function circle(R: number): Point2[] {
  const n = Math.round(Math.PI * R);
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)];
  });
}

function outerSideOf(points: Point2[], i: number): Side {
  const n = points.length;
  const p = points[(i - 5 + n) % n];
  const c = points[i];
  const q = points[(i + 5) % n];
  const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
  return cross < 0 ? 'right' : 'left';
}

function coversWrap(start: number, end: number, i: number, n: number): boolean {
  const s = ((start % n) + n) % n;
  return ((i - s + n) % n) < (((end - start + n) % n) + 1);
}

// Annular sector around a circle of radius Rc centred at the origin, angles a1..a2, radii rIn..rOut.
function sector(a1: number, a2: number, rIn: number, rOut: number, steps = 64): Point2[] {
  const ring: Point2[] = [];
  for (let k = 0; k <= steps; k++) {
    const a = a1 + ((a2 - a1) * k) / steps;
    ring.push([rIn * Math.cos(a), -rIn * Math.sin(a)]);
  }
  for (let k = steps; k >= 0; k--) {
    const a = a1 + ((a2 - a1) * k) / steps;
    ring.push([rOut * Math.cos(a), -rOut * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return ring;
}

// Same sector but around centre (cx, cz) with outward direction (sin u, -cos u).
function sectorAt(cx: number, cz: number, u1: number, u2: number, rIn: number, rOut: number, steps = 16): Point2[] {
  const ring: Point2[] = [];
  const dir = (u: number, rho: number): Point2 => [cx + rho * Math.sin(u), cz - rho * Math.cos(u)];
  for (let k = 0; k <= steps; k++) ring.push(dir(u1 + ((u2 - u1) * k) / steps, rIn));
  for (let k = steps; k >= 0; k--) ring.push(dir(u1 + ((u2 - u1) * k) / steps, rOut));
  ring.push(ring[0]);
  return ring;
}

// Clockwise stadium with two R corners (arcs centred at (+-200, 0)), ~2 m spacing on straights.
function stadium(R: number, arcSteps: number): Point2[] {
  const dA = Math.PI / arcSteps;
  const pts: Point2[] = [];
  for (let k = 0; k <= 100; k++) pts.push([2 * k, -R]);
  for (let j = 1; j < arcSteps; j++) { const u = j * dA; pts.push([200 + R * Math.sin(u), -R * Math.cos(u)]); }
  pts.push([200, R]);
  for (let k = 1; k <= 200; k++) pts.push([200 - 2 * k, R]);
  for (let j = 1; j < arcSteps; j++) { const v = j * dA; pts.push([-200 - R * Math.sin(v), R * Math.cos(v)]); }
  pts.push([-200, -R]);
  for (let k = 1; k <= 99; k++) pts.push([-200 + 2 * k, -R]);
  return pts;
}

describe('098 OSM run-offs edge cases', () => {
  it('EDGE1: fallback switches at min radius 100 and 150 — 99.5 m circle gravel 18, 100.5 and 149.5 paved 12, 150.5 none', () => {
    const g = detectRunoffs(circle(99.5));
    expect(g).toHaveLength(1);
    expect(g[0].surface).toBe('gravel');
    expect(g[0].widthMeters).toBeCloseTo(18, 9);
    expect(g[0].side).toBe(outerSideOf(circle(99.5), 50));

    const p1 = detectRunoffs(circle(100.5));
    expect(p1).toHaveLength(1);
    expect(p1[0].surface).toBe('runoff');
    expect(p1[0].widthMeters).toBeCloseTo(12, 9);

    const p2 = detectRunoffs(circle(149.5));
    expect(p2).toHaveLength(1);
    expect(p2[0].surface).toBe('runoff');

    expect(detectRunoffs(circle(150.5))).toHaveLength(0);
  });

  it('EDGE2: an OSM gravel run on the outside of one R90 stadium corner suppresses that corner fallback but not the other corner', () => {
    const pts = stadium(90, 20); // arc1 indices 101..119 about (200,0); arc2 321..339 about (-200,0)
    const n = pts.length;
    // Gravel hugging arc1 outside only (u = pi/4..3pi/4 -> indices ~105..115), extent 108-96 = 12 m.
    const out = detectRunoffs(pts, [sectorAt(200, 0, Math.PI / 4, (3 * Math.PI) / 4, 98, 108)]);
    expect(out).toHaveLength(2);
    const [s1, s2] = out;
    expect(s1.start).toBeLessThanOrEqual(s1.end);
    expect(s2.start).toBeLessThanOrEqual(s2.end);
    // OSM run: ~12 m gravel on arc1 outside, inside indices 104..116.
    expect(Math.abs(s1.widthMeters - 12)).toBeLessThanOrEqual(1);
    expect(s1.surface).toBe('gravel');
    expect(s1.side).toBe(outerSideOf(pts, 110));
    expect(s1.start).toBeGreaterThanOrEqual(104);
    expect(s1.end).toBeLessThanOrEqual(116);
    expect(coversWrap(s1.start, s1.end, 110, n)).toBe(true);
    // Fallback run: 18 m gravel on arc2 outside; arc1 fallback suppressed.
    expect(s2.widthMeters).toBeCloseTo(18, 9);
    expect(s2.surface).toBe('gravel');
    expect(s2.side).toBe(outerSideOf(pts, 330));
    expect(coversWrap(s2.start, s2.end, 330, n)).toBe(true);
    // No run-off reaches straight middles.
    expect(coversWrap(s1.start, s1.end, 220, n) || coversWrap(s2.start, s2.end, 220, n)).toBe(false);
    expect(coversWrap(s1.start, s1.end, 10, n) || coversWrap(s2.start, s2.end, 10, n)).toBe(false);
  });

  it('EDGE3: two adjacent gravel sectors with extents 16 and 32 m split into two consecutive runs (diff > 6 m from median)', () => {
    const ring = circle(400); // n = 1257
    const ang = (i: number) => (2 * Math.PI * i) / ring.length;
    const polys = [
      sector(ang(100), ang(150), 408, 422), // extent 16
      sector(ang(140), ang(200), 408, 438), // extent 32, overlaps angles 140..150
    ];
    const out = detectRunoffs(ring, polys, 6);
    expect(out).toHaveLength(2);
    expect(out[1].start).toBe(out[0].end + 1);
    for (const s of out) {
      expect(s.surface).toBe('gravel');
      expect(s.side).toBe(outerSideOf(ring, 160));
    }
    expect(out[0].start).toBeGreaterThanOrEqual(99);
    expect(out[0].start).toBeLessThanOrEqual(101);
    expect(out[0].end).toBeGreaterThanOrEqual(138);
    expect(out[0].end).toBeLessThanOrEqual(141);
    expect(out[1].end).toBeGreaterThanOrEqual(199);
    expect(out[1].end).toBeLessThanOrEqual(201);
    expect(Math.abs(out[0].widthMeters - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[1].widthMeters - 32)).toBeLessThanOrEqual(1);
  });

  it('EDGE4: a gravel sector crossing only 4 consecutive indices is dropped (runs < 5 indices)', () => {
    const ring = circle(400);
    const ang = (i: number) => (2 * Math.PI * i) / ring.length;
    expect(detectRunoffs(ring, [sector(ang(100), ang(103), 408, 428, 8)], 6)).toHaveLength(0);
  });

  it('EDGE5: a gravel crossing of 2.5 m extent is clamped to 4 m, not rounded to 3', () => {
    const ring = circle(400);
    const ang = (i: number) => (2 * Math.PI * i) / ring.length;
    const out = detectRunoffs(ring, [sector(ang(100), ang(200), 407, 408.5)], 6);
    expect(out).toHaveLength(1);
    expect(out[0].surface).toBe('gravel');
    expect(out[0].widthMeters).toBeCloseTo(4, 9);
    expect(Math.abs(out[0].start - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[0].end - 200)).toBeLessThanOrEqual(1);
  });

  it('EDGE6: a kerb covering the indices moves the outer edge to half + KERB_WIDTH, giving extent 20.8 -> width 21', () => {
    const ring = circle(400);
    const ang = (i: number) => (2 * Math.PI * i) / ring.length;
    const side = outerSideOf(ring, 150);
    const kerbs: TrackSegment[] = [{ start: 95, end: 205, side }];
    const out = detectRunoffs(ring, [sector(ang(100), ang(200), 408, 428)], 6, kerbs);
    expect(out).toHaveLength(1);
    expect(out[0].surface).toBe('gravel');
    expect(out[0].widthMeters).toBeCloseTo(21, 9); // extent 428 - (400 + 6 + KERB_WIDTH) = 20.8, rounded to 1 m
    expect(Math.abs(out[0].start - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(out[0].end - 200)).toBeLessThanOrEqual(1);
  });

  it('EDGE7: the fallback span of a whole R90 circle wraps: single run-off start 268, end 14', () => {
    const ring = circle(90); // n = 283
    expect(ring.length).toBe(283);
    const out = detectRunoffs(ring);
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe(268);
    expect(out[0].end).toBe(14);
    expect(out[0].widthMeters).toBeCloseTo(18, 9);
    expect(out[0].surface).toBe('gravel');
    expect(out[0].side).toBe(outerSideOf(ring, 140));
  });

  it('EDGE8: a gravel sector across the index-0 seam yields one wrapped run (start n-25 +-1, end 25 +-1, width 22)', () => {
    const ring = circle(400); // n = 1257
    const n = ring.length;
    const ang = (i: number) => (2 * Math.PI * i) / n;
    const out = detectRunoffs(ring, [sector(ang(n - 25), ang(n + 25), 408, 428)], 6);
    expect(out).toHaveLength(1);
    expect(Math.abs(out[0].start - (n - 25))).toBeLessThanOrEqual(1);
    expect(Math.abs(out[0].end - 25)).toBeLessThanOrEqual(1);
    expect(out[0].widthMeters).toBeLessThanOrEqual(23);
    expect(out[0].widthMeters).toBeGreaterThanOrEqual(21);
    expect(out[0].surface).toBe('gravel');
  });

  it('EDGE9: loadGravelPolygons returns [] for a missing areas file', () => {
    expect(loadGravelPolygons(join(__dirname, 'does-not-exist-098.json'), [9, 45])).toEqual([]);
  });

  it('EDGE10: loadGravelPolygons keeps only closed natural=sand|shingle / surface=gravel|sand rings, projected with projectLonLat and the given origin', () => {
    const origin: [number, number] = [9.0, 45.0];
    const polys = loadGravelPolygons(join(__dirname, '__fixtures__', '098-areas.json'), origin);
    expect(polys).toHaveLength(5); // ids 1-5; grass, fence, closed:false, natural=grass, natural=gravel excluded
    const expected = projectLonLat([[9.0001, 45.0001], [9.0002, 45.0001], [9.00015, 45.0002]], origin);
    const ring = polys.find((r: Point2[]) => r.length >= 3 && Math.hypot(r[0][0] - expected[0][0], r[0][1] - expected[0][1]) < 1e-9);
    if (!ring) throw new Error('feature id 1 ring not found in loadGravelPolygons output');
    expect(ring.length === 3 || ring.length === 4).toBe(true);
    for (let k = 0; k < 3; k++) {
      expect(ring[k][0]).toBeCloseTo(expected[k][0], 9);
      expect(ring[k][1]).toBeCloseTo(expected[k][1], 9);
    }
  });
});

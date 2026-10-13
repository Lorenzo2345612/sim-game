import { describe, expect, it } from 'vitest';
import { detectKerbs, detectRunoffs, radii } from '../../../tools/track-builder/corners';
import type { Point2 } from '../../../src/track/geo';
import type { TrackSegment } from '../../../src/core/types';

// Clockwise stadium (right turns), same construction as the acceptance tests.
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

function circle(R: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)];
  });
}

// Closed loop of many tiny tangent corners: each corner's radius run is under 8 points.
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

function span(seg: TrackSegment, n: number): number {
  return ((seg.end - seg.start + n) % n) + 1;
}

function expectIndicesInRange(segs: TrackSegment[], n: number): void {
  for (const s of segs) {
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.start).toBeLessThan(n);
    expect(s.end).toBeGreaterThanOrEqual(0);
    expect(s.end).toBeLessThan(n);
  }
}

describe('026 corner analysis edge cases', () => {
  it('EDGE1: counter-clockwise (left-turn) loop puts inside kerbs on the left, exit kerbs and run-offs on the right, all sorted by start', () => {
    const pts = stadium(80, 126).map(([x, z]): Point2 => [x, -z]);
    const n = pts.length;
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(4);
    expect(kerbs.map(k => k.start)).toEqual([...kerbs.map(k => k.start)].sort((a, b) => a - b));
    const inside = kerbs.filter(k => k.side === 'left');
    const exit = kerbs.filter(k => k.side === 'right');
    expect(inside).toHaveLength(2);
    expect(exit).toHaveLength(2);
    const TURN = [100, 426];
    inside.forEach((k, i) => {
      expect(k.start).toBeGreaterThanOrEqual(TURN[i] - 12);
      expect(k.start).toBeLessThanOrEqual(TURN[i] - 10);
      expect(exit[i].end).toBe(k.end);
      expect(span(exit[i], n)).toBe(15);
    });
    const runoff = detectRunoffs(pts);
    expect(runoff.map(s => s.start)).toEqual([...runoff.map(s => s.start)].sort((a, b) => a - b));
    expect(runoff).toHaveLength(2);
    for (const s of runoff) {
      expect(s.side).toBe('right');
      expect(s.surface).toBe('gravel');
    }
  });

  it('EDGE2: full-circle track where every point qualifies is one run: one inside kerb, one exit kerb, one run-off, indices in [0, n)', () => {
    const pts = circle(100, 314);
    const n = pts.length;
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(2);
    expectIndicesInRange(kerbs, n);
    expect(kerbs.filter(k => k.side === 'left')).toHaveLength(1);
    expect(kerbs.filter(k => k.side === 'right')).toHaveLength(1);
    const runoff = detectRunoffs(pts);
    expect(runoff).toHaveLength(1);
    expectIndicesInRange(runoff, n);
    expect(runoff[0].side).toBe('right');
    expect(runoff[0].surface).toBe('gravel');
  });

  it('EDGE3: corner runs shorter than 8 points produce no kerbs but still produce run-offs', () => {
    const pts = manyCorners(50, 3, 20);
    expect(detectKerbs(pts)).toHaveLength(0);
    const runoff = detectRunoffs(pts);
    expect(runoff).toHaveLength(50);
    for (const s of runoff) {
      expect(s.side).toBe('left');
      expect(s.surface).toBe('gravel');
      expect(s.widthMeters).toBeCloseTo(18, 9);
    }
  });

  it('EDGE4: circumradius beyond the 1e6 cap is clamped to 1e6', () => {
    const pts = circle(5e6, 314);
    const r = radii(pts);
    expect(r).toHaveLength(pts.length);
    for (const v of r) expect(v).toBeCloseTo(1e6, 6);
  });

  it('EDGE5: turns of r = 200 m (below KERB_RADIUS, at or above 150) get kerbs but no run-offs (098 rule)', () => {
    const pts = stadium(200, 315);
    const kerbs = detectKerbs(pts);
    expect(kerbs.filter(k => k.side === 'right')).toHaveLength(2);
    expect(kerbs.filter(k => k.side === 'left')).toHaveLength(2);
    expect(detectRunoffs(pts)).toHaveLength(0); // min radius >= 150: no run-off since 098
  });

  it('EDGE6: run-off of a turn crossing index 0 wraps (end < start) instead of splitting', () => {
    const base = stadium(80, 126);
    const n = base.length;
    const rot = Array.from({ length: n }, (_, i): Point2 => base[(i + 100) % n]);
    const runoff = detectRunoffs(rot);
    expect(runoff).toHaveLength(2);
    expectIndicesInRange(runoff, n);
    const wrapping = runoff.filter(s => s.end < s.start);
    expect(wrapping).toHaveLength(1);
    expect(wrapping[0].side).toBe('left');
    expect(wrapping[0].surface).toBe('gravel');
  });
});

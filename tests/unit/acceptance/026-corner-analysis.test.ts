import { describe, expect, it } from 'vitest';
import { detectKerbs, detectRunoffs, radii } from '../../../tools/track-builder/corners';
import type { Point2 } from '../../../src/track/geo';
import type { TrackSegment } from '../../../src/core/types';

// Arc runs [inclusive first, inclusive last] of the tangent-aligned stadiums below.
// Turn points include both tangent points; ~2 m spacing; travelled clockwise on the
// map (east +X, north -Z), so both turns are 'right' turns.
const TURN_80: [number, number][] = [[100, 226], [426, 552]];

// Closed lap: 400 m straight, 180° arc of radius R, 400 m straight, 180° arc of radius R.
// Straights step exactly 2 m; the arc uses arcSteps chords so both tangent points land
// exactly on sample indices.
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
    return [R * Math.cos(a), -R * Math.sin(a)]; // counter-clockwise in map view
  });
}

function byStart<T extends TrackSegment>(segs: T[]): T[] {
  return [...segs].sort((a, b) => a.start - b.start);
}

describe('026 corner analysis acceptance', () => {
  it('AT1: radii of a counter-clockwise circle of r = 100 m at 2 m spacing are 100 ±1 at every point', () => {
    const pts = circle(100, 314);
    const r = radii(pts);
    expect(r).toHaveLength(pts.length);
    for (const v of r) expect(Math.abs(v - 100)).toBeLessThanOrEqual(1);
  });

  it('AT2: radius of collinear (straight) points is the 1e6 cap', () => {
    const pts = Array.from({ length: 50 }, (_, k): Point2 => [2 * k, 0]);
    const r = radii(pts);
    expect(r).toHaveLength(pts.length);
    for (const v of r) expect(v).toBeCloseTo(1e6, 6);
  });

  it('AT3: two 400 m straights + two 180° turns of r = 80 m yield per turn an inside kerb, an outside entry kerb and an outside exit kerb (task 142)', () => {
    const pts = stadium(80, 126);
    const kerbs = detectKerbs(pts);
    expect(kerbs).toHaveLength(6);
    const inside = byStart(kerbs.filter(k => k.side === 'right')); // turning side
    const outside = byStart(kerbs.filter(k => k.side === 'left')); // outside
    expect(inside).toHaveLength(2);
    expect(outside).toHaveLength(2 + 2);
    inside.forEach((k, i) => {
      const [t0, t1] = TURN_80[i];
      expect(k.start).toBeGreaterThanOrEqual(t0 - 17); // inside: [start-15, end+15]
      expect(k.start).toBeLessThanOrEqual(t0 - 15);
      expect(k.end).toBeGreaterThanOrEqual(t1 + 15);
      expect(k.end).toBeLessThanOrEqual(t1 + 17);
      const [entry, exit] = outside.filter(o => o.start >= t0 - 22 && o.end <= t1 + 22);
      expect(entry.start).toBeGreaterThanOrEqual(t0 - 22); // outside entry: [start-20, start+5]
      expect(entry.start).toBeLessThanOrEqual(t0 - 20);
      expect(entry.end).toBeGreaterThanOrEqual(t0 + 3);
      expect(entry.end).toBeLessThanOrEqual(t0 + 5);
      expect(exit.start).toBeGreaterThanOrEqual(t1 - 6); // outside exit: [end-5, end+20]
      expect(exit.start).toBeLessThanOrEqual(t1 - 4);
      expect(exit.end).toBeGreaterThanOrEqual(t1 + 20);
      expect(exit.end).toBeLessThanOrEqual(t1 + 22);
    });
  });

  it('AT4: same loop has 2 gravel 18 m run-offs on the outside of each turn, extended 15 points beyond it', () => {
    const pts = stadium(80, 126);
    const runoff = byStart(detectRunoffs(pts));
    expect(runoff).toHaveLength(2);
    runoff.forEach((s, i) => {
      const [t0, t1] = TURN_80[i];
      expect(s.side).toBe('left'); // outside
      expect(s.surface).toBe('gravel'); // min radius of the run < 150
      expect(s.widthMeters).toBeCloseTo(18, 9);
      expect(s.start).toBeGreaterThanOrEqual(t0 - 16);
      expect(s.start).toBeLessThanOrEqual(t0 - 15);
      expect(s.end).toBeGreaterThanOrEqual(t1 + 15);
      expect(s.end).toBeLessThanOrEqual(t1 + 16);
    });
  });

  it('AT5: same loop with r = 300 m turns yields no run-offs (sweepers, task 098) and 4 kerbs: inside and outside exit per turn (task 142)', () => {
    const pts = stadium(300, 471);
    expect(detectRunoffs(pts)).toHaveLength(0); // min radius >= 150: no run-off since 098
    const kerbs = byStart(detectKerbs(pts));
    expect(kerbs).toHaveLength(4); // 300 < CORNER_RADIUS: per turn an inside and an outside exit kerb
    expect(kerbs.filter(k => k.side === 'right')).toHaveLength(2);
    expect(kerbs.filter(k => k.side === 'left')).toHaveLength(2);
  });

  it('AT6: loop crossing index 0 inside a turn yields wrapping kerb segments (end < start) instead of a split', () => {
    const pts = stadium(80, 126);
    const n = pts.length;
    const shift = TURN_80[0][0]; // first turn now starts at index 0
    const rot = Array.from({ length: n }, (_, i): Point2 => pts[(i + shift) % n]);
    const kerbs = detectKerbs(rot);
    expect(kerbs).toHaveLength(6); // inside kerbs not split in two
    const wrapping = kerbs.filter(k => k.end < k.start);
    expect(wrapping).toHaveLength(2); // inside kerb and outside entry kerb of the turn spanning [0, 126]
    const inside = wrapping.find(k => k.side === 'right');
    expect(inside?.start).toBeGreaterThanOrEqual(n - 17);
    expect(inside?.start).toBeLessThanOrEqual(n - 15);
    expect(inside?.end).toBeGreaterThanOrEqual(126 + 15);
    expect(inside?.end).toBeLessThanOrEqual(126 + 17);
  });
});

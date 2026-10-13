import { describe, it, expect } from 'vitest';
import type { LapEvent } from '../../../src/core/types';
import type { Point2 } from '../../../src/track/geo';
import { polylineLength } from '../../../src/track/geo';
import { resampleClosed } from '../../../src/track/centerline';
import { TrackProgress } from '../../../src/track/trackProgress';
import { LapTimer } from '../../../src/track/lapTimer';

const L = 1000;
const SECTORS: [number, number, number] = [0, 333, 666];

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function sig(e: LapEvent): string {
  return e.type === 'lapStarted'
    ? `lapStarted/${e.lap}`
    : e.type === 'lapCompleted'
      ? `lapCompleted/${e.lap}`
      : e.type === 'sectorCompleted'
        ? `sectorCompleted/${e.sector}`
        : `lapInvalidated/${e.lap}`;
}

function circle(r: number, n: number): Point2[] {
  const out: Point2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

// TRACK resamples to ~314 segments, so the +/-60 window applies;
// SMALL has N = 64 <= 121, so the planner decision forces a global search.
const TRACK: Point2[] = resampleClosed(circle(100, 64), 2);
const SMALL: Point2[] = circle(100, 64);
const SQUARE: Point2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('008 track progress and lap timer edge cases', () => {
  it('EDGE1: constructor requires at least 3 points and length is the closed perimeter', () => {
    expect(() => new TrackProgress([])).toThrow(Error);
    expect(() => new TrackProgress([[0, 0]])).toThrow(Error);
    expect(() => new TrackProgress([[0, 0], [10, 0]])).toThrow(Error);
    expect(() => new TrackProgress([[0, 0], [10, 0], [5, 10]])).not.toThrow();
    expect(new TrackProgress(SQUARE).length).toBeCloseTo(40, 6);
    expect(new TrackProgress(TRACK).length).toBeCloseTo(polylineLength(TRACK, true), 6);
  });

  it('EDGE2: update reuses one ProgressSample object across calls', () => {
    const tp = new TrackProgress(TRACK);
    const a = tp.update(100, 0);
    const distA = a.distance;
    const b = tp.update(0, 100);
    expect(b).toBe(a);
    expect(b.distance).not.toBeCloseTo(distA, 3);
  });

  it('EDGE3: the window wraps across index 0, a teleport beyond it needs reset, and small tracks search globally', () => {
    const tp = new TrackProgress(TRACK);
    for (let arc = 0; arc <= 620; arc += 10) {
      tp.update(100 * Math.cos(arc / 100), 100 * Math.sin(arc / 100));
    }
    const after = tp.update(100 * Math.cos(0.01), 100 * Math.sin(0.01));
    within(after.distance, 1, 1);
    const wrong = tp.update(-100, 0);
    expect(Math.abs(wrong.distance - tp.length / 2)).toBeGreaterThan(50);
    tp.reset();
    const right = tp.update(-100, 0);
    within(right.distance, tp.length / 2, 1);
    within(right.lateral, 0, 0.1);
    const sm = new TrackProgress(SMALL);
    sm.update(100, 0);
    const far = sm.update(-100, 0);
    within(far.distance, sm.length / 2, 1);
    within(far.lateral, 0, 0.1);
  });

  it('EDGE4: a corner equidistant to two segments picks the lowest segment index', () => {
    const tp = new TrackProgress(SQUARE);
    const s = tp.update(10, 10);
    expect(s.index).toBe(1);
    within(s.distance, 20, 1e-6);
    within(s.lateral, 0, 1e-6);
  });

  it('EDGE5: the closing segment carries the wrap distance and right-of-travel lateral sign', () => {
    const tp = new TrackProgress(SQUARE);
    const s = tp.update(-2, 5);
    expect(s.index).toBe(3);
    within(s.distance, 35, 1e-6);
    within(s.lateral, -2, 1e-6);
  });

  it('EDGE6: duplicate and sub-1e-9 m segments are skipped and never poison the result', () => {
    const dup = new TrackProgress([[0, 0], [0, 0], [10, 0], [10, 10]]);
    const s = dup.update(10, -1);
    expect(Number.isFinite(s.distance)).toBe(true);
    expect(Number.isFinite(s.lateral)).toBe(true);
    expect(s.index).toBe(1);
    within(s.distance, 10, 1e-6);
    within(s.lateral, -1, 1e-6);
    const tiny = new TrackProgress([[0, 0], [1e-10, 0], [10, 0], [10, 10]]);
    const t = tiny.update(5e-11, -0.1);
    expect(t.index).toBe(1);
    within(t.distance, 0, 1e-6);
    within(t.lateral, -0.1, 1e-6);
  });

  it('EDGE7: a non-finite x or z returns the previous sample unchanged', () => {
    const tp = new TrackProgress(TRACK);
    const fresh = tp.update(NaN, 0);
    within(fresh.distance, 0, 0);
    within(fresh.lateral, 0, 0);
    const bad: [number, number][] = [[0, Infinity], [-Infinity, -Infinity], [1, NaN]];
    for (const [x, z] of bad) {
      const s = tp.update(x, z);
      within(s.distance, 0, 0);
      within(s.lateral, 0, 0);
    }
    const good = tp.update(0, 100);
    within(good.distance, tp.length / 4, 1);
    for (const [x, z] of bad) {
      const s = tp.update(x, z);
      expect(s.distance).toBe(good.distance);
      expect(s.lateral).toBe(good.lateral);
      expect(s.index).toBe(good.index);
    }
    const after = tp.update(100 * Math.cos(1), 100 * Math.sin(1));
    within(after.distance, 100, 1);
  });

  it('EDGE8: sector lines passed before the first crossing emit nothing and do not consume tracking', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(100, 0)).toEqual([]);
    expect(timer.update(400, 1)).toEqual([]);
    expect(timer.update(960, 2)).toEqual([]);
    expect(timer.update(5, 3).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(340, 4).map(sig)).toEqual(['sectorCompleted/1']);
  });

  it('EDGE9: out-of-range or non-finite inputs are ignored without state change and reset clears prevDistance', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(999, 0)).toEqual([]);
    const invalid: [number, number][] = [
      [-0.5, 1],
      [NaN, 2],
      [Infinity, 3],
      [500, NaN],
      [1000, 4],
    ];
    for (const [d, t] of invalid) {
      expect(timer.update(d, t)).toEqual([]);
    }
    expect(timer.lap).toBe(0);
    expect(timer.update(5, 5).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.currentLapTime(8)).toBeCloseTo(3, 10);
    expect(timer.update(1005, 9)).toEqual([]);
    expect(timer.update(-1, 10)).toEqual([]);
    expect(timer.lap).toBe(1);
    expect(timer.lastLapTime).toBe(null);
    timer.update(995, 11);
    timer.reset();
    expect(timer.update(20, 12)).toEqual([]);
    expect(timer.lap).toBe(0);
    expect(timer.lastLapTime).toBe(null);
    expect(timer.bestLapTime).toBe(null);
    expect(timer.currentLapTime(50)).toBe(null);
  });

  it('EDGE10: a sector line at exactly the new distance fires once and a jump past the finish outside the 50 m window completes nothing', () => {
    const timer = new LapTimer(L, SECTORS);
    timer.update(999, 0);
    expect(timer.update(5, 1).map(sig)).toEqual(['lapStarted/1']);
    const exact = timer.update(333, 2);
    expect(exact.map(sig)).toEqual(['sectorCompleted/1']);
    if (exact[0].type === 'sectorCompleted') {
      within(exact[0].sectorTime, 1, 1e-6);
    }
    expect(timer.update(333, 3)).toEqual([]);
    expect(timer.update(334, 4)).toEqual([]);
    expect(timer.update(945, 5).map(sig)).toEqual(['sectorCompleted/2']);
    expect(timer.update(55, 6)).toEqual([]);
    expect(timer.lap).toBe(1);
    expect(timer.lastLapTime).toBe(null);
    expect(timer.bestLapTime).toBe(null);
  });
});

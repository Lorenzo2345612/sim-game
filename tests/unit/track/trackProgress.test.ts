import { describe, it, expect } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { resampleClosed } from '../../../src/track/centerline';
import { TrackProgress } from '../../../src/track/trackProgress';

function circle(r: number, n: number): Point2[] {
  const out: Point2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

const TRACK: Point2[] = resampleClosed(circle(100, 64), 2);

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('TrackProgress', () => {
  it('start point gives distance ~0 and lateral ~0', () => {
    const tp = new TrackProgress(TRACK);
    const s = tp.update(100, 0);
    expect(s.index).toBe(0);
    within(s.distance, 0, 0.01);
    within(s.lateral, 0, 0.05);
  });

  it('outside the circle gives negative lateral, inside positive', () => {
    const tp = new TrackProgress(TRACK);
    within(tp.update(110, 0).lateral, -10, 0.1);
    tp.reset();
    within(tp.update(90, 0).lateral, 10, 0.1);
  });

  it('arc length matches distance along the circle', () => {
    const tp = new TrackProgress(TRACK);
    for (let arc = 0; arc <= 620; arc += 10) {
      const a = arc / 100;
      within(tp.update(100 * Math.cos(a), 100 * Math.sin(a)).distance, arc, 1);
    }
  });

  it('radius 105 vs 95 at the same angle give opposite lateral signs', () => {
    const tp = new TrackProgress(TRACK);
    const a = 1;
    // update reuses its sample, so read the primitive at call time
    const outer = tp.update(105 * Math.cos(a), 105 * Math.sin(a)).lateral;
    const inner = tp.update(95 * Math.cos(a), 95 * Math.sin(a)).lateral;
    within(Math.abs(outer), 5, 0.2);
    within(Math.abs(inner), 5, 0.2);
    expect(outer * inner).toBeLessThan(0);
  });

  it('quarter turn gives a quarter of the length', () => {
    const tp = new TrackProgress(TRACK);
    within(tp.update(0, 100).distance, tp.length / 4, 1);
  });

  it('continuous travel increases distance monotonically', () => {
    const tp = new TrackProgress(TRACK);
    let prev = -1;
    let last = 0;
    for (let k = 0; k < 1000; k++) {
      const a = (2 * Math.PI * 0.99 * k) / 999;
      const s = tp.update(100 * Math.cos(a), 100 * Math.sin(a));
      expect(s.distance).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = s.distance;
      last = s.distance;
    }
    expect(last).toBeGreaterThan(0.97 * tp.length);
    const wrapped = tp.update(100 * Math.cos(0.01), 100 * Math.sin(0.01));
    expect(wrapped.distance).toBeLessThan(10);
  });

  it('reset forces a global search', () => {
    const tp = new TrackProgress(TRACK);
    tp.update(0, 100);
    tp.reset();
    within(tp.update(-100, 0).distance, tp.length / 2, 1);
  });
});

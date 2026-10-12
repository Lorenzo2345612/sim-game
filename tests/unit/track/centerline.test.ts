import { describe, it, expect } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { polylineLength } from '../../../src/track/geo';
import {
  catmullRomClosed,
  resampleClosed,
  cumulativeLengths,
} from '../../../src/track/centerline';

function circle(r: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [r * Math.cos(a), r * Math.sin(a)] as Point2;
  });
}

function distToPerimeter(p: Point2, s: number): number {
  const ax = Math.abs(p[0] - s / 2);
  const az = Math.abs(p[1] - s / 2);
  const ox = Math.max(ax - s / 2, 0);
  const oz = Math.max(az - s / 2, 0);
  return ox === 0 && oz === 0 ? s / 2 - Math.max(ax, az) : Math.hypot(ox, oz);
}

describe('catmullRomClosed', () => {
  it('keeps first point and count', () => {
    const c = circle(100, 64);
    const out = catmullRomClosed(c, 10);
    expect(out.length).toBe(640);
    expect(out[0][0]).toBeCloseTo(c[0][0], 9);
    expect(out[0][1]).toBeCloseTo(c[0][1], 9);
  });

  it('length of circle is close to 2*pi*r', () => {
    const c = circle(100, 64);
    const out = catmullRomClosed(c, 10);
    const cum = cumulativeLengths(out, true);
    const L = cum[cum.length - 1];
    expect(Math.abs(L - 628.3)).toBeLessThanOrEqual(628.3 * 0.005);
  });

  it('square stays near its perimeter', () => {
    const sq: Point2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const out = catmullRomClosed(sq, 10);
    for (const p of out) {
      expect(Number.isNaN(p[0])).toBe(false);
      expect(Number.isNaN(p[1])).toBe(false);
      expect(distToPerimeter(p, 100)).toBeLessThanOrEqual(20);
    }
  });

  it('tolerates duplicate consecutive points', () => {
    const pts: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 5],
      [0, 5],
    ];
    const out = catmullRomClosed(pts, 8);
    for (const p of out) {
      expect(Number.isNaN(p[0])).toBe(false);
      expect(Number.isNaN(p[1])).toBe(false);
    }
  });

  it('throws with fewer than 3 points', () => {
    expect(() => catmullRomClosed([[0, 0], [1, 1]], 10)).toThrow(
      Error('catmullRomClosed: need at least 3 points'),
    );
  });
});

describe('resampleClosed', () => {
  it('produces uniform spacing', () => {
    const smoothed = catmullRomClosed(circle(100, 64), 20);
    const cum = cumulativeLengths(smoothed, true);
    const L = cum[cum.length - 1];
    const out = resampleClosed(smoothed, 2);
    const N = Math.round(L / 2);
    expect(out.length).toBe(N);
    const step = L / N;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const d = Math.hypot(out[j][0] - out[i][0], out[j][1] - out[i][1]);
      expect(Math.abs(d - step)).toBeLessThanOrEqual(0.02 * step);
    }
  });

  it('preserves the first point', () => {
    const c = circle(100, 64);
    const out = resampleClosed(c, 2);
    expect(out[0][0]).toBe(c[0][0]);
    expect(out[0][1]).toBe(c[0][1]);
  });

  it('tiny circle returns at least 3 points', () => {
    const out = resampleClosed(circle(3, 64), 10);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('matches closed polyline length of the input', () => {
    const c = circle(100, 64);
    const out = resampleClosed(c, 2);
    const L = polylineLength(c, true);
    expect(out.length).toBe(Math.round(L / 2));
  });
});

describe('cumulativeLengths', () => {
  it('of a square closed and open', () => {
    const sq: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const closed = cumulativeLengths(sq, true);
    expect(closed.length).toBe(5);
    [0, 10, 20, 30, 40].forEach((v, i) => expect(closed[i]).toBeCloseTo(v, 9));
    const open = cumulativeLengths(sq, false);
    expect(open.length).toBe(4);
    [0, 10, 20, 30].forEach((v, i) => expect(open[i]).toBeCloseTo(v, 9));
  });

  it('handles empty input', () => {
    expect(cumulativeLengths([], true).length).toBe(1);
    expect(cumulativeLengths([], true)[0]).toBe(0);
    expect(cumulativeLengths([], false).length).toBe(0);
  });
});

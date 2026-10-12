import { describe, it, expect } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import { polylineLength } from '../../../src/track/geo';
import {
  catmullRomClosed,
  resampleClosed,
  cumulativeLengths,
} from '../../../src/track/centerline';

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

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

describe('005 centerline smoothing acceptance', () => {
  it('AT1: catmullRomClosed on a 64-point circle gives 1280 points, keeps c[0] and stays near 2*pi*r', () => {
    const c = circle(100, 64);
    const out = catmullRomClosed(c, 20);
    expect(out.length).toBe(64 * 20);
    within(out[0][0], c[0][0], 1e-9);
    within(out[0][1], c[0][1], 1e-9);
    within(polylineLength(out, true), 628.32, 628.32 * 0.005);
  });

  it('AT2: catmullRomClosed of a 100x100 square has no NaN and stays within 20 m of its perimeter', () => {
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

  it('AT3: resampleClosed of a 64-point circle at 2 m gives N = round(L/2) uniform points and preserves c[0]', () => {
    const c = circle(100, 64);
    const L = polylineLength(c, true);
    const out = resampleClosed(c, 2);
    const N = Math.round(L / 2);
    expect(out.length).toBe(N);
    expect(out[0][0]).toBe(c[0][0]);
    expect(out[0][1]).toBe(c[0][1]);
    const step = L / N;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const d = Math.hypot(out[j][0] - out[i][0], out[j][1] - out[i][1]);
      within(d, step, 0.02 * step);
    }
  });

  it('AT4: resampleClosed of a tiny circle r=3 at spacing 10 still returns at least 3 points', () => {
    const out = resampleClosed(circle(3, 64), 10);
    expect(out.length).toBeGreaterThanOrEqual(3);
  });

  it('AT5: cumulativeLengths of a 10x10 square is [0,10,20,30,40] closed and [0,10,20,30] open', () => {
    const sq: Point2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const closed = cumulativeLengths(sq, true);
    expect(closed.length).toBe(5);
    [0, 10, 20, 30, 40].forEach((v, i) => within(closed[i], v, 1e-9));
    const open = cumulativeLengths(sq, false);
    expect(open.length).toBe(4);
    [0, 10, 20, 30].forEach((v, i) => within(open[i], v, 1e-9));
  });

  it('AT6: catmullRomClosed with duplicate consecutive points produces no NaN', () => {
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
});

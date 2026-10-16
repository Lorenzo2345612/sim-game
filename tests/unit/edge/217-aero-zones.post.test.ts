import { describe, expect, it } from 'vitest';
import { cumulativeLengths } from '../../../src/track/centerline';
import { deriveAeroZones, inAeroZone } from '../../../src/track/aeroZones';

function squareStep(side: number, step: number): [number, number][] {
  const per = side / step;
  const pts: [number, number][] = [];
  for (let k = 0; k < 4 * per; k++) {
    if (k < per) pts.push([k * step, 0]);
    else if (k < 2 * per) pts.push([side, (k - per) * step]);
    else if (k < 3 * per) pts.push([side - (k - 2 * per) * step, side]);
    else pts.push([0, side - (k - 3 * per) * step]);
  }
  return pts;
}

function circle(r: number, spacing = 2): [number, number][] {
  const n = Math.round((2 * Math.PI * r) / spacing);
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

function polygon(n: number, spacing: number): [number, number][] {
  const r = spacing / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, j): [number, number] => {
    const a = (j / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

function lapLength(cl: [number, number][]): number {
  return cumulativeLengths(cl, true)[cl.length];
}

function expectFourRuns(zones: { start: number; end: number }[]): void {
  const starts = [24, 424, 824, 1224];
  expect(zones).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    expect(zones[i].start).toBeCloseTo(starts[i], 6);
    expect(zones[i].end - zones[i].start).toBeCloseTo(348, 6);
  }
}

describe('217 aero zones post-code gaps', () => {
  it('POST1: exact nearest-point ties resolve to the later point (2 m square run starts at side_start + 24)', () => {
    expectFourRuns(deriveAeroZones(squareStep(400, 2)));
  });

  it('POST2: coincident points (zero total length) yield []', () => {
    expect(deriveAeroZones([[1, 1], [1, 1], [1, 1], [1, 1]])).toEqual([]);
  });

  it('POST3: NaN coordinates yield [] without throwing', () => {
    expect(deriveAeroZones([[0, 0], [100, 0], [NaN, 50], [0, 100]])).toEqual([]);
  });

  it('POST4: repeating the first point at the end gives the same zones as the open form', () => {
    const open = squareStep(400, 2);
    const closed: [number, number][] = [...open, [open[0][0], open[0][1]]];
    expectFourRuns(deriveAeroZones(closed));
  });

  it('POST5: regular polygons straddle the strict 1/800 curvature limit (N=2010 none, N=2011 full lap)', () => {
    expect(deriveAeroZones(polygon(2010, 2.5))).toEqual([]);
    const cl = polygon(2011, 2.5);
    const L = lapLength(cl);
    const zones = deriveAeroZones(cl);
    expect(zones).toHaveLength(1);
    expect(zones[0].start).toBeCloseTo(0, 6);
    expect(Math.abs(zones[0].end - L)).toBeLessThanOrEqual(1e-6);
  });

  it('POST6: 2 m-spaced circles just below/above the curvature limit', () => {
    expect(deriveAeroZones(circle(700))).toEqual([]);
    const cl = circle(900);
    const L = lapLength(cl);
    const zones = deriveAeroZones(cl);
    expect(zones).toHaveLength(1);
    expect(zones[0].start).toBeCloseTo(0, 6);
    expect(Math.abs(zones[0].end - L)).toBeLessThanOrEqual(1e-6);
    expect(inAeroZone(zones, 1234.5, L)).toBe(true);
    expect(inAeroZone(zones, -0.5, L)).toBe(true);
  });

  it('POST7: lapLength 0 makes inAeroZone false without throwing', () => {
    expect(inAeroZone([{ start: 0, end: 100 }], 50, 0)).toBe(false);
    expect(inAeroZone([{ start: 0, end: 100 }], 0, 0)).toBe(false);
  });

  it('POST8: a zero-length zone matches only distances congruent to its start', () => {
    const zones = [{ start: 5, end: 5 }];
    expect(inAeroZone(zones, 5, 100)).toBe(true);
    expect(inAeroZone(zones, 105, 100)).toBe(true);
    expect(inAeroZone(zones, 4, 100)).toBe(false);
    expect(inAeroZone(zones, 6, 100)).toBe(false);
  });
});

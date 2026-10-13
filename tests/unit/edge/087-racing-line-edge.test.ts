import { describe, expect, it } from 'vitest';
import { computeRacingLine, mengerCurvature } from '../../../src/ai/racingLine';
import { circleTrack } from '../../fixtures/circleTrack';

const N = circleTrack.centerline.length;

function rightNormal(c: [number, number][], i: number): [number, number] {
  const n = c.length;
  const prev = c[(i - 1 + n) % n];
  const next = c[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return [-dz / len, dx / len];
}

function bytes(a: Float64Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

describe('087 racing line edge cases', () => {
  it('EDGE1: centerline shorter than 3 points throws an Error', () => {
    expect(() => computeRacingLine([], 6, 1)).toThrow(Error);
    expect(() => computeRacingLine([[0, 0]], 6, 1)).toThrow(Error);
    expect(() => computeRacingLine([[0, 0], [1, 0]], 6, 1)).toThrow(Error);
  });

  it('EDGE2: offsets clamp inclusively to halfWidth - margin, and a negative band acts as 0', () => {
    const clamped = computeRacingLine(circleTrack.centerline, 6, 1);
    for (let i = 0; i < clamped.offsets.length; i++) {
      expect(Math.abs(clamped.offsets[i])).toBeLessThanOrEqual(5);
    }
    const negativeBand = computeRacingLine(circleTrack.centerline, 2, 5);
    const zeroBand = computeRacingLine(circleTrack.centerline, 1, 1);
    for (const line of [negativeBand, zeroBand]) {
      for (let i = 0; i < line.offsets.length; i++) {
        expect(line.offsets[i]).toBeCloseTo(0, 12);
      }
      for (let i = 0; i < line.points.length; i += 2) {
        expect(line.points[i]).toBeCloseTo(circleTrack.centerline[i / 2][0], 9);
        expect(line.points[i + 1]).toBeCloseTo(circleTrack.centerline[i / 2][1], 9);
      }
    }
  });

  it('EDGE3: zero iterations performs no sweeps and keeps the centerline', () => {
    const line = computeRacingLine(circleTrack.centerline, 6, 1, 0);
    for (let i = 0; i < line.offsets.length; i++) {
      expect(line.offsets[i]).toBeCloseTo(0, 12);
    }
    for (let i = 0; i < line.points.length; i += 2) {
      expect(line.points[i]).toBeCloseTo(circleTrack.centerline[i / 2][0], 9);
      expect(line.points[i + 1]).toBeCloseTo(circleTrack.centerline[i / 2][1], 9);
    }
  });

  it('EDGE4: default margin and iterations equal explicit 1 and 600', () => {
    const implicit = computeRacingLine(circleTrack.centerline, 6);
    const marginSet = computeRacingLine(circleTrack.centerline, 6, 1);
    const allSet = computeRacingLine(circleTrack.centerline, 6, 1, 600);
    expect(bytes(implicit.offsets)).toEqual(bytes(marginSet.offsets));
    expect(bytes(implicit.points)).toEqual(bytes(marginSet.points));
    expect(bytes(implicit.dist)).toEqual(bytes(marginSet.dist));
    expect(bytes(marginSet.offsets)).toEqual(bytes(allSet.offsets));
    expect(bytes(marginSet.dist)).toEqual(bytes(allSet.dist));
    expect(marginSet.length).toBe(allSet.length);
  });

  it('EDGE5: output has one offset and dist entry and two point coords per centerline point', () => {
    const line = computeRacingLine(circleTrack.centerline, 6, 1, 5);
    expect(line.offsets).toBeInstanceOf(Float64Array);
    expect(line.points).toBeInstanceOf(Float64Array);
    expect(line.dist).toBeInstanceOf(Float64Array);
    expect(line.offsets.length).toBe(N);
    expect(line.points.length).toBe(2 * N);
    expect(line.dist.length).toBe(N);
    expect(typeof line.length).toBe('number');
  });

  it('EDGE6: dist is cumulative from point 0 and length includes the closing segment', () => {
    const line = computeRacingLine(circleTrack.centerline, 6, 1);
    expect(line.dist.length).toBe(N);
    expect(line.dist[0]).toBeCloseTo(0, 12);
    const seg = (j: number): number => {
      const a = (j % N) * 2;
      const b = ((j + 1) % N) * 2;
      return Math.hypot(line.points[b] - line.points[a], line.points[b + 1] - line.points[a + 1]);
    };
    let acc = 0;
    for (let i = 1; i < N; i++) {
      acc += seg(i - 1);
      expect(line.dist[i]).toBeCloseTo(acc, 6);
    }
    expect(line.length).toBeCloseTo(acc + seg(N - 1), 6);
  });

  it('EDGE7: the centerline input is not mutated', () => {
    const input = circleTrack.centerline.map((p): [number, number] => [p[0], p[1]]);
    const before = input.map((p): [number, number] => [p[0], p[1]]);
    computeRacingLine(input, 6, 1, 10);
    expect(input).toEqual(before);
  });

  it('EDGE8: mengerCurvature of a left turn on R 50 is -0.02', () => {
    const k = mengerCurvature(50, 0, 0, -50, -50, 0);
    expect(Math.abs(k + 0.02)).toBeLessThanOrEqual(1e-9);
  });

  it('EDGE9: mengerCurvature of coincident points is 0 without NaN', () => {
    expect(mengerCurvature(0, 0, 0, 0, 0, 0)).toBeCloseTo(0, 9);
    expect(mengerCurvature(0, 0, 0, 0, 1, 0)).toBeCloseTo(0, 9);
    expect(mengerCurvature(0, 0, 1, 0, 1, 0)).toBeCloseTo(0, 9);
    expect(mengerCurvature(0, 0, 1, 0, 0, 0)).toBeCloseTo(0, 9);
  });

  it('EDGE10: every point is the centerline point plus its offset along the right normal', () => {
    const line = computeRacingLine(circleTrack.centerline, 6, 1);
    const c = circleTrack.centerline;
    for (let i = 0; i < N; i++) {
      const [nx, nz] = rightNormal(c, i);
      expect(line.points[2 * i]).toBeCloseTo(c[i][0] + line.offsets[i] * nx, 6);
      expect(line.points[2 * i + 1]).toBeCloseTo(c[i][1] + line.offsets[i] * nz, 6);
    }
  });
});

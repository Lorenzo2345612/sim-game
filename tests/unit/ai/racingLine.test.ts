import { describe, expect, it } from 'vitest';
import { computeRacingLine, mengerCurvature } from '../../../src/ai/racingLine';

function rightNormalAt(cl: [number, number][], i: number): [number, number] {
  const n = cl.length;
  const prev = cl[(i - 1 + n) % n];
  const next = cl[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return [-dz / len, dx / len];
}

function circle(R: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / n;
    return [R * Math.cos(a), R * Math.sin(a)];
  });
}

// Turtle: 4 straights of 200 m joined by 90-degree right-hand arcs of R 30.
function roundedSquare(): { cl: [number, number][]; apex: number[] } {
  const R = 30;
  const straight = 200;
  const arcSteps = 24;
  const cl: [number, number][] = [];
  const apex: number[] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  cl.push([0, 0]);
  for (let corner = 0; corner < 4; corner++) {
    for (let t = 2; t <= straight; t += 2) {
      x += 2 * Math.cos(phi);
      z += 2 * Math.sin(phi);
      cl.push([x, z]);
    }
    const cx = x - R * Math.sin(phi);
    const cz = z + R * Math.cos(phi);
    const phi0 = phi;
    for (let k = 1; k <= arcSteps; k++) {
      const a = phi0 + (k * Math.PI) / (2 * arcSteps);
      x = cx + R * Math.sin(a);
      z = cz - R * Math.cos(a);
      phi = a;
      if (k === arcSteps && corner === 3) break;
      cl.push([x, z]);
      if (k === arcSteps / 2) apex.push(cl.length - 1);
    }
  }
  return { cl, apex };
}

function bytes(a: Float64Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

describe('087 racing line edge cases', () => {
  it('throws when the centerline has fewer than 3 points', () => {
    expect(() => computeRacingLine([], 6)).toThrow(Error);
    expect(() => computeRacingLine([[0, 0]], 6)).toThrow(Error);
    expect(() => computeRacingLine([[0, 0], [1, 0]], 6)).toThrow(Error);
    expect(() => computeRacingLine(circle(50, 3), 6)).not.toThrow();
  });

  it('on a 3-point ring every s > n/4 is skipped so the line stays on the centerline', () => {
    const cl = circle(50, 3);
    const line = computeRacingLine(cl, 6, 1);
    expect(Array.from(line.offsets)).toEqual([0, 0, 0]);
    // 4 points keep s = 1 (n/4 = 1) and the optimizer does run
    const line4 = computeRacingLine(circle(50, 4), 6, 1);
    expect(Math.max(...Array.from(line4.offsets).map(Math.abs))).toBeGreaterThan(0);
  });

  it('halfWidth - margin < 0 is treated as 0', () => {
    const { cl } = roundedSquare();
    for (const [halfWidth, margin] of [[3, 10], [1, 1], [0, 0], [-2, 0]] as const) {
      const line = computeRacingLine(cl, halfWidth, margin);
      expect(Math.max(...Array.from(line.offsets).map(Math.abs))).toBe(0);
    }
  });

  it('does not mutate the input centerline', () => {
    const { cl } = roundedSquare();
    const before = JSON.stringify(cl);
    computeRacingLine(cl, 6, 1);
    expect(JSON.stringify(cl)).toBe(before);
  });

  it('clamps offsets to ±(halfWidth - margin) and the clamp is reachable', () => {
    const { cl } = roundedSquare();
    const line = computeRacingLine(cl, 6, 1);
    for (const o of line.offsets) expect(Math.abs(o)).toBeLessThanOrEqual(5);
    expect(Math.max(...Array.from(line.offsets).map(Math.abs))).toBe(5);
  });

  it('positive offsets move points along the right normal; apexes of right-hand corners are positive', () => {
    const { cl, apex } = roundedSquare();
    const line = computeRacingLine(cl, 6, 1);
    for (let i = 0; i < cl.length; i++) {
      const [nx, nz] = rightNormalAt(cl, i);
      expect(line.points[2 * i] - cl[i][0]).toBeCloseTo(line.offsets[i] * nx, 9);
      expect(line.points[2 * i + 1] - cl[i][1]).toBeCloseTo(line.offsets[i] * nz, 9);
    }
    for (const i of apex) expect(line.offsets[i]).toBeGreaterThan(0);
  });

  it('dist starts at 0, is cumulative along the line, and length closes the ring', () => {
    const square: [number, number][] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const line = computeRacingLine(square, 1, 1);
    expect(line.dist.length).toBe(4);
    expect(line.dist[0]).toBe(0);
    expect(Array.from(line.dist)).toEqual([0, 100, 150, 250]);
    expect(line.length).toBe(300);
    const { cl } = roundedSquare();
    const moved = computeRacingLine(cl, 6, 1);
    let acc = 0;
    for (let i = 1; i < cl.length; i++) {
      acc += Math.hypot(moved.points[2 * i] - moved.points[2 * i - 2], moved.points[2 * i + 1] - moved.points[2 * i - 1]);
      expect(moved.dist[i]).toBeCloseTo(acc, 9);
    }
    const cdx = moved.points[0] - moved.points[2 * cl.length - 2];
    const cdz = moved.points[1] - moved.points[2 * cl.length - 1];
    expect(moved.length).toBeCloseTo(acc + Math.hypot(cdx, cdz), 9);
  });

  it('mengerCurvature is 0 for collinear and coincident points, never NaN', () => {
    const cases: [number, number, number, number, number, number][] = [
      [0, 0, 1, 0, 2, 0],
      [0, 0, 2, 0, 1, 0],
      [0, 0, 0, 0, 1, 0],
      [1, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [3, 3, 3, 3, 3, 3],
      [-5, -5, 0, 0, 5, 5],
    ];
    for (const [ax, az, bx, bz, cx, cz] of cases) {
      const k = mengerCurvature(ax, az, bx, bz, cx, cz);
      expect(Number.isFinite(k)).toBe(true);
      expect(k).toBe(0);
    }
  });

  it('mengerCurvature is positive for a right turn and negative for a left turn', () => {
    expect(mengerCurvature(0, 0, 1, 0, 2, 1)).toBeGreaterThan(0);
    expect(mengerCurvature(0, 0, 1, 0, 2, -1)).toBeLessThan(0);
    expect(mengerCurvature(50, 0, 0, 50, -50, 0)).toBeCloseTo(0.02, 12);
    expect(mengerCurvature(-50, 0, 0, 50, 50, 0)).toBeCloseTo(-0.02, 12);
  });

  it('default margin 1 and iterations 25 match the explicit arguments', () => {
    const { cl } = roundedSquare();
    const implicit = computeRacingLine(cl, 6);
    const explicit = computeRacingLine(cl, 6, 1, 25);
    expect(bytes(implicit.offsets)).toEqual(bytes(explicit.offsets));
    expect(bytes(implicit.points)).toEqual(bytes(explicit.points));
    expect(bytes(implicit.dist)).toEqual(bytes(explicit.dist));
    expect(implicit.length).toBe(explicit.length);
  });

  it('is deterministic on a small fixture', () => {
    const { cl } = roundedSquare();
    const a = computeRacingLine(cl, 6, 1);
    const b = computeRacingLine(cl, 6, 1);
    expect(bytes(a.offsets)).toEqual(bytes(b.offsets));
    expect(bytes(a.points)).toEqual(bytes(b.points));
    expect(bytes(a.dist)).toEqual(bytes(b.dist));
    expect(a.length).toBe(b.length);
  });

  it('iterations = 0 leaves the line on the centerline', () => {
    const { cl } = roundedSquare();
    const line = computeRacingLine(cl, 6, 1, 0);
    expect(Math.max(...Array.from(line.offsets).map(Math.abs))).toBe(0);
    for (let i = 0; i < cl.length; i++) {
      expect(line.points[2 * i]).toBe(cl[i][0]);
      expect(line.points[2 * i + 1]).toBe(cl[i][1]);
    }
  });

  it('runs without NaN when n is not a multiple of the coarse steps', () => {
    const cl = circle(80, 22);
    const line = computeRacingLine(cl, 6, 1);
    for (const o of line.offsets) {
      expect(Number.isFinite(o)).toBe(true);
      expect(Math.abs(o)).toBeLessThanOrEqual(5);
    }
    for (const p of line.points) expect(Number.isFinite(p)).toBe(true);
    expect(Number.isFinite(line.length)).toBe(true);
  });
});

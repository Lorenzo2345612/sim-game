import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRacingLine, mengerCurvature } from '../../../src/ai/racingLine';

const ROOT = join(__dirname, '..', '..', '..');

function allFinite(a: Float64Array): boolean {
  for (const v of a) if (!Number.isFinite(v)) return false;
  return true;
}

function maxAbs(a: Float64Array): number {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m;
}

function regularPolygon(n: number, r: number): [number, number][] {
  const cl: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    cl.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return cl;
}

// Perimeter order, `dir` 1 = (0,0)->(side,0)->... (right-hand turns), -1 = mirrored.
function squareLoop(side: number, perSide: number, dir: 1 | -1): [number, number][] {
  const step = side / perSide;
  const raw: [number, number][] = [];
  for (let i = 0; i < perSide; i++) raw.push([i * step, 0]);
  for (let i = 0; i < perSide; i++) raw.push([side, i * step]);
  for (let i = 0; i < perSide; i++) raw.push([side - i * step, side]);
  for (let i = 0; i < perSide; i++) raw.push([0, side - i * step]);
  return dir === 1 ? raw : raw.slice().reverse();
}

function rightNormal(c: [number, number][], i: number): [number, number] {
  const n = c.length;
  const prev = c[(i - 1 + n) % n];
  const next = c[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return [-dz / len, dx / len];
}

describe('087 racing line post-code gaps', () => {
  it('POST1: a 3-point centerline skips every K1999 level (s > n/4) and returns the centerline', () => {
    const cl: [number, number][] = [[0, 0], [10, 0], [5, 8]];
    const line = computeRacingLine(cl, 6, 1);
    expect(line.offsets.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(line.offsets[i]).toBe(0);
    for (let i = 0; i < 3; i++) {
      expect(line.points[2 * i]).toBe(cl[i][0]);
      expect(line.points[2 * i + 1]).toBe(cl[i][1]);
    }
    expect(allFinite(line.dist)).toBe(true);
    expect(Number.isFinite(line.length)).toBe(true);
  });

  it('POST2: a loop whose length is not divisible by the active step still closes consistently', () => {
    const cl = regularPolygon(9, 50);
    const line = computeRacingLine(cl, 6, 1);
    const n = cl.length;
    expect(allFinite(line.offsets)).toBe(true);
    expect(allFinite(line.points)).toBe(true);
    expect(maxAbs(line.offsets)).toBeLessThanOrEqual(5 + 1e-9);
    for (let i = 0; i < n; i++) {
      const [nx, nz] = rightNormal(cl, i);
      expect(line.points[2 * i]).toBeCloseTo(cl[i][0] + line.offsets[i] * nx, 6);
      expect(line.points[2 * i + 1]).toBeCloseTo(cl[i][1] + line.offsets[i] * nz, 6);
    }
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const dx = line.points[2 * i] - line.points[2 * i - 2];
      const dz = line.points[2 * i + 1] - line.points[2 * i - 1];
      acc += Math.hypot(dx, dz);
      expect(line.dist[i]).toBeCloseTo(acc, 6);
    }
    const cdx = line.points[0] - line.points[2 * n - 2];
    const cdz = line.points[1] - line.points[2 * n - 1];
    expect(line.length).toBeCloseTo(acc + Math.hypot(cdx, cdz), 6);
  });

  it('POST3: a point whose wrapped neighbours coincide falls back to normal (0, -1) without NaN', () => {
    const cl: [number, number][] = [[0, 0], [5, 0], [0, 0], [0, 10]];
    const line = computeRacingLine(cl, 2, 0.5);
    expect(allFinite(line.offsets)).toBe(true);
    expect(allFinite(line.points)).toBe(true);
    expect(allFinite(line.dist)).toBe(true);
    expect(Number.isFinite(line.length)).toBe(true);
    expect(line.points[2]).toBeCloseTo(5, 12);
    expect(line.points[3]).toBeCloseTo(0 - line.offsets[1], 12);
  });

  it('POST4: negative iterations performs no sweeps and keeps the centerline', () => {
    const cl = squareLoop(40, 8, 1);
    const line = computeRacingLine(cl, 6, 1, -3);
    for (let i = 0; i < line.offsets.length; i++) expect(line.offsets[i]).toBe(0);
    for (let i = 0; i < cl.length; i++) {
      expect(line.points[2 * i]).toBeCloseTo(cl[i][0], 12);
      expect(line.points[2 * i + 1]).toBeCloseTo(cl[i][1], 12);
    }
  });

  it('POST5: the clamp bound is exactly halfWidth - margin, inclusive', () => {
    const cl = squareLoop(40, 8, 1);
    const wide = computeRacingLine(cl, 3, -1);
    expect(maxAbs(wide.offsets)).toBe(4);
    const tight = computeRacingLine(cl, 3, 1);
    expect(maxAbs(tight.offsets)).toBe(2);
    const tiny = computeRacingLine(cl, 1.0001, 1);
    expect(maxAbs(tiny.offsets)).toBeLessThanOrEqual(1e-4 + 1e-15);
    expect(maxAbs(tiny.offsets)).toBeGreaterThanOrEqual(1e-4 * 0.99);
  });

  it('POST6: negative halfWidth with zero margin acts as a zero band', () => {
    const cl = squareLoop(40, 8, 1);
    const line = computeRacingLine(cl, -3, 0);
    for (let i = 0; i < line.offsets.length; i++) expect(line.offsets[i]).toBe(0);
  });

  it('POST7: positive offsets move right of travel; a mirrored loop flips the sign', () => {
    const side = 40;
    const cornersOf = (cl: [number, number][]): number[] => {
      const idx: number[] = [];
      for (let i = 0; i < cl.length; i++) {
        const onX = cl[i][0] < 1e-9 || cl[i][0] > side - 1e-9;
        const onZ = cl[i][1] < 1e-9 || cl[i][1] > side - 1e-9;
        if (onX && onZ) idx.push(i);
      }
      return idx;
    };
    const rightCl = squareLoop(side, 8, 1);
    const rightCorners = cornersOf(rightCl);
    expect(rightCorners.length).toBe(4);
    const rightHanded = computeRacingLine(rightCl, 3, 1);
    for (const i of rightCorners) expect(rightHanded.offsets[i]).toBeGreaterThan(0);
    const leftCl = squareLoop(side, 8, -1);
    const leftCorners = cornersOf(leftCl);
    expect(leftCorners.length).toBe(4);
    const leftHanded = computeRacingLine(leftCl, 3, 1);
    for (const i of leftCorners) expect(leftHanded.offsets[i]).toBeLessThan(0);
  });

  it('POST8: mengerCurvature is positive for a right turn in the x,z plane and negative for a left turn', () => {
    expect(mengerCurvature(0, 0, 1, 0, 1, 1)).toBeGreaterThan(0);
    expect(mengerCurvature(0, 0, 1, 0, 1, -1)).toBeLessThan(0);
  });

  it('POST9: src/ai has no Math.random and imports nothing from three, rapier or physics', () => {
    const dir = join(ROOT, 'src', 'ai');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      // type-only CarSpec import is allowed (088)
      const src = readFileSync(join(dir, f), 'utf8').replace(/import type[^;]*from\s+['"][^'"]+['"];?/g, '');
      expect(src).not.toMatch(/Math\.random/);
      expect(src).not.toMatch(/from\s+['"]three['"]/);
      expect(src).not.toMatch(/from\s+['"]@dimforge/);
      expect(src).not.toMatch(/from\s+['"].*src\/physics/);
      expect(src).not.toMatch(/from\s+['"]\.\.\/physics/);
    }
  });

  it('POST10: duplicated consecutive centerline points keep every output finite', () => {
    const cl: [number, number][] = [
      [0, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 10],
    ];
    const line = computeRacingLine(cl, 2, 0.5);
    expect(allFinite(line.offsets)).toBe(true);
    expect(allFinite(line.points)).toBe(true);
    expect(allFinite(line.dist)).toBe(true);
    expect(Number.isFinite(line.length)).toBe(true);
    expect(maxAbs(line.offsets)).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it('POST11: mengerCurvature stays finite for extreme coordinates', () => {
    const k = mengerCurvature(1e7, 1e7, 1e7 + 1, 1e7, 1e7 + 2, 1e7 + 0.5);
    expect(Number.isFinite(k)).toBe(true);
    expect(k).toBeGreaterThan(0);
  });

  it('POST12: the iterations parameter is honoured between 1 and 25', () => {
    const cl = squareLoop(40, 8, 1);
    const one = computeRacingLine(cl, 3, 1, 1);
    const many = computeRacingLine(cl, 3, 1, 25);
    expect(Array.from(one.offsets)).not.toEqual(Array.from(many.offsets));
    expect(maxAbs(one.offsets)).toBeLessThanOrEqual(2 + 1e-9);
    expect(maxAbs(many.offsets)).toBeLessThanOrEqual(2 + 1e-9);
  });
});

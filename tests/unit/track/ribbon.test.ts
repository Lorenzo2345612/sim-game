import { describe, it, expect } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { RibbonGeometry } from '../../../src/track/ribbon';
import { buildRibbon } from '../../../src/track/ribbon';

function circle(r: number, n: number): Point2[] {
  return Array.from({ length: n }, (_, k) => {
    const a = (2 * Math.PI * k) / n;
    return [r * Math.cos(a), -r * Math.sin(a)] as Point2;
  });
}

const SQUARE: Point2[] = [[0, 0], [0, -100], [100, -100], [100, 0]];

function vertex(g: RibbonGeometry, k: number): [number, number, number] {
  return [g.positions[3 * k], g.positions[3 * k + 1], g.positions[3 * k + 2]];
}

function triangleIndices(g: RibbonGeometry): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = 0; t + 2 < g.indices.length; t += 3) {
    out.push([g.indices[t], g.indices[t + 1], g.indices[t + 2]]);
  }
  return out;
}

describe('buildRibbon', () => {
  it('matches buffer sizes for N=4 and N=64', () => {
    for (const shape of [SQUARE, circle(100, 64)]) {
      const g = buildRibbon(shape, 12, 0.05);
      expect(g.positions.length).toBe(shape.length * 6);
      expect(g.indices.length).toBe(shape.length * 6);
      expect(g.uvs.length).toBe(shape.length * 4);
      expect(g.vertexCount).toBe(2 * shape.length);
    }
  });

  it('throws for fewer than 3 points', () => {
    expect(() => buildRibbon([[0, 0], [1, 1]], 12, 0)).toThrow(Error('buildRibbon: need at least 3 points'));
  });

  it('all triangles face up on square and circle', () => {
    for (const shape of [SQUARE, circle(100, 64)]) {
      const g = buildRibbon(shape, 12, 0.05);
      for (const [a, b, c] of triangleIndices(g)) {
        const [ax, , az] = vertex(g, a);
        const [bx, , bz] = vertex(g, b);
        const [cx, , cz] = vertex(g, c);
        const ux = bx - ax;
        const uz = bz - az;
        const wx = cx - ax;
        const wz = cz - az;
        expect(uz * wx - ux * wz).toBeGreaterThan(0);
      }
    }
  });

  it('left and right vertices of each pair are width apart', () => {
    const g = buildRibbon(circle(100, 64), 12, 0.05);
    for (let i = 0; i < 64; i++) {
      const [lx, ly, lz] = vertex(g, 2 * i);
      const [rx, ry, rz] = vertex(g, 2 * i + 1);
      expect(Math.abs(Math.hypot(rx - lx, ry - ly, rz - lz) - 12)).toBeLessThanOrEqual(1e-4);
    }
  });

  it('all vertices have the requested y', () => {
    const g = buildRibbon(SQUARE, 12, 0.05);
    for (let k = 0; k < g.vertexCount; k++) {
      expect(g.positions[3 * k + 1]).toBeCloseTo(0.05, 6);
    }
  });

  it('right vertex is east of left on the first square segment', () => {
    const g = buildRibbon(SQUARE, 12, 0.05);
    expect(vertex(g, 1)[0]).toBeGreaterThan(vertex(g, 0)[0]);
  });

  it('indices are valid and close the loop', () => {
    for (const shape of [SQUARE, circle(100, 64)]) {
      const n = shape.length;
      const g = buildRibbon(shape, 12, 0.05);
      for (const idx of g.indices) {
        expect(idx).toBeLessThan(g.vertexCount);
      }
      const lastA = 2 * (n - 1);
      const lastB = 2 * (n - 1) + 1;
      const closing = triangleIndices(g).some(
        ([a, b, c]) =>
          new Set([a, b, c]).has(lastA) && new Set([a, b, c]).has(lastB) && (new Set([a, b, c]).has(0) || new Set([a, b, c]).has(1)),
      );
      expect(closing).toBe(true);
    }
  });

  it('uv u is 0 on left and 1 on right, v starts at 0 and increases', () => {
    const g = buildRibbon(circle(100, 64), 12, 0.05);
    for (let i = 0; i < 64; i++) {
      expect(g.uvs[4 * i]).toBe(0);
      expect(g.uvs[4 * i + 2]).toBe(1);
      expect(g.uvs[4 * i + 1]).toBe(g.uvs[4 * i + 3]);
    }
    expect(g.uvs[1]).toBe(0);
    expect(g.uvs[5]).toBeGreaterThan(g.uvs[1]);
  });
});

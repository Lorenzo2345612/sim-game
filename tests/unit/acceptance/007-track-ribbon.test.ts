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

const LOOP: Point2[] = [
  [0, 0],
  [0, -100],
  [10, -100],
  [10, 0],
];

interface Triangle {
  a: number;
  b: number;
  c: number;
  verts: Set<number>;
}

function trianglesOf(g: RibbonGeometry): Triangle[] {
  const out: Triangle[] = [];
  for (let t = 0; t + 2 < g.indices.length; t += 3) {
    const a = g.indices[t];
    const b = g.indices[t + 1];
    const c = g.indices[t + 2];
    out.push({ a, b, c, verts: new Set([a, b, c]) });
  }
  return out;
}

function vertex(g: RibbonGeometry, k: number): [number, number, number] {
  return [g.positions[3 * k], g.positions[3 * k + 1], g.positions[3 * k + 2]];
}

describe('007 track ribbon acceptance', () => {
  it('AT1: circle r=100, N=100 gives vertexCount 200 and buffer sizes 600/600/400', () => {
    const g = buildRibbon(circle(100, 100), 12, 0.02);
    expect(g.vertexCount).toBe(200);
    expect(g.positions.length).toBe(600);
    expect(g.indices.length).toBe(600);
    expect(g.uvs.length).toBe(400);
  });

  it('AT2: every triangle normal faces +Y', () => {
    const g = buildRibbon(circle(100, 100), 12, 0.02);
    for (const { a, b, c } of trianglesOf(g)) {
      const [ax, , az] = vertex(g, a);
      const [bx, , bz] = vertex(g, b);
      const [cx, , cz] = vertex(g, c);
      const ux = bx - ax;
      const uz = bz - az;
      const wx = cx - ax;
      const wz = cz - az;
      expect(uz * wx - ux * wz).toBeGreaterThan(0);
    }
  });

  it('AT3: L_i to R_i is 12 ±1e-4 for every pair and every vertex y is 0.02', () => {
    const g = buildRibbon(circle(100, 100), 12, 0.02);
    for (let i = 0; i < 100; i++) {
      const [lx, ly, lz] = vertex(g, 2 * i);
      const [rx, ry, rz] = vertex(g, 2 * i + 1);
      const d = Math.hypot(rx - lx, ry - ly, rz - lz);
      expect(Math.abs(d - 12)).toBeLessThanOrEqual(1e-4);
    }
    for (let k = 0; k < g.vertexCount; k++) {
      expect(g.positions[3 * k + 1]).toBeCloseTo(0.02, 6);
    }
  });

  it('AT4: on the loop facing -Z at index 0, vertex 0 (left) lies west of vertex 1 (right)', () => {
    const g = buildRibbon(LOOP, 12, 0);
    expect(g.positions[0]).toBeLessThan(g.positions[3]);
  });

  it('AT5: every index < vertexCount and the closing segment (N-1 -> 0) is present', () => {
    const g = buildRibbon(LOOP, 12, 0);
    for (const idx of g.indices) {
      expect(idx).toBeLessThan(g.vertexCount);
    }
    const lastA = 2 * (LOOP.length - 1);
    const lastB = 2 * (LOOP.length - 1) + 1;
    const closing = trianglesOf(g).some(
      ({ verts }) => verts.has(lastA) && verts.has(lastB) && (verts.has(0) || verts.has(1)),
    );
    expect(closing).toBe(true);
  });
});

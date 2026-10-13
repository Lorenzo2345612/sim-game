import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectRunoffs } from '../../../tools/track-builder/corners';
import { loadGravelPolygons } from '../../../tools/track-builder/osmAreas';
import type { Point2 } from '../../../src/track/geo';

function circle(R: number): Point2[] {
  const n = Math.round(Math.PI * R);
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)];
  });
}

// Annular sector between the centerline angles of indices i0..i1, from radius r0 to r1 (R-relative).
function sector(R: number, n: number, i0: number, i1: number, r0: number, r1: number): Point2[] {
  const a0 = (2 * Math.PI * i0) / n;
  const a1 = (2 * Math.PI * i1) / n;
  const pts: Point2[] = [];
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const a = a0 + ((a1 - a0) * k) / steps;
    pts.push([r0 * Math.cos(a), -r0 * Math.sin(a)]);
  }
  for (let k = steps; k >= 0; k--) {
    const a = a0 + ((a1 - a0) * k) / steps;
    pts.push([r1 * Math.cos(a), -r1 * Math.sin(a)]);
  }
  pts.push(pts[0]);
  return pts;
}

function stadium(R: number, arcSteps: number): Point2[] {
  const dA = Math.PI / arcSteps;
  const pts: Point2[] = [];
  for (let k = 0; k <= 100; k++) pts.push([2 * k, -R]);
  for (let j = 1; j < arcSteps; j++) { const u = j * dA; pts.push([200 + R * Math.sin(u), -R * Math.cos(u)]); }
  pts.push([200, R]);
  for (let k = 1; k <= 200; k++) pts.push([200 - 2 * k, R]);
  for (let j = 1; j < arcSteps; j++) { const v = j * dA; pts.push([-200 - R * Math.sin(v), R * Math.cos(v)]); }
  pts.push([-200, -R]);
  for (let k = 1; k < 100; k++) pts.push([-200 + 2 * k, -R]);
  return pts;
}

const tmp = mkdtempSync(join(tmpdir(), 'osm-runoffs-post-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let fileNo = 0;
function areasFile(content: object): string {
  const path = join(tmp, `areas-${fileNo++}.json`);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('098 OSM run-offs post-coder gaps', () => {
  it('an empty point list yields no segments even with polygons, and an empty polygon list behaves like no gravel', () => {
    expect(detectRunoffs([], [[[0, 0], [1, 0], [1, 1]]] as Point2[][], 6)).toEqual([]);
    const bare = detectRunoffs(circle(90));
    expect(detectRunoffs(circle(90), [], 6)).toEqual(bare);
  });

  it('the run width is the median extent rounded to the nearest metre (22.7 becomes 23)', () => {
    const ring = circle(400);
    const n = ring.length;
    const out = detectRunoffs(ring, [sector(400, n, 99, 150, 402, 428.7)], 6);
    expect(out).toHaveLength(1);
    expect(out[0].widthMeters).toBe(23);
  });

  it('a band entirely beyond the half + 40 m lateral reach produces no run-off', () => {
    const ring = circle(400);
    const n = ring.length;
    expect(detectRunoffs(ring, [sector(400, n, 99, 150, 447, 453)], 6)).toEqual([]);
  });

  it('stacked bands on the same line take the farthest crossing for the extent', () => {
    const ring = circle(400);
    const n = ring.length;
    const polys = [sector(400, n, 99, 150, 410, 420), sector(400, n, 99, 150, 425, 435)];
    const out = detectRunoffs(ring, polys, 6);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 100, end: 150, surface: 'gravel', widthMeters: 29 });
  });

  it('an extent differing from the run median by 6 m or less does not split the run', () => {
    const ring = circle(400);
    const n = ring.length;
    // Extents 24 (100..175) then 29 (161..200): |29 - 24| = 5 <= 6, median stays 24.
    const polys = [sector(400, n, 99, 175, 402, 430), sector(400, n, 160, 201, 402, 435)];
    const out = detectRunoffs(ring, polys, 6);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 100, end: 200, widthMeters: 24 });
  });

  it('gravel bands on both sides of the track yield one run per side', () => {
    const ring = circle(400);
    const n = ring.length;
    const out = detectRunoffs(ring, [sector(400, n, 99, 150, 408, 428), sector(400, n, 600, 651, 372, 392)], 6);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.surface === 'gravel')).toBe(true);
    expect(new Set(out.map((s) => s.side)).size).toBe(2);
    for (const s of out) expect(s.widthMeters).toBe(22);
  });

  it('an OSM run on the fallback side but more than 15 indices away does not suppress the fallback', () => {
    const pts = stadium(90, 142);
    // Band left of the back straight, x 30..90 (indices ~298..326), both turn fallbacks are on the left.
    const band: Point2[] = [[30, 102], [90, 102], [90, 120], [30, 120]];
    const out = detectRunoffs(pts, [band], 6);
    expect(out).toHaveLength(3);
    const osm = out.filter((s) => s.widthMeters === 24);
    expect(osm).toHaveLength(1);
    expect(osm[0]).toMatchObject({ side: 'left', surface: 'gravel' });
    expect(osm[0].start).toBeGreaterThan(271);
    const fallbacks = out.filter((s) => s.widthMeters === 18);
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks.every((s) => s.side === 'left' && s.surface === 'gravel')).toBe(true);
    expect(out.map((s) => s.start)).toEqual([...out.map((s) => s.start)].sort((a, b) => a - b));
  });

  it('loadGravelPolygons returns [] when the features field is missing or empty', () => {
    expect(loadGravelPolygons(areasFile({ source: 'OSM' }), [0, 0])).toEqual([]);
    expect(loadGravelPolygons(areasFile({ features: [] }), [0, 0])).toEqual([]);
  });
});

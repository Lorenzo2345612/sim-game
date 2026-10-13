import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectRunoffs } from '../../../tools/track-builder/corners';
import { loadGravelPolygons } from '../../../tools/track-builder/osmAreas';
import { projectLonLat, type LonLat, type Point2 } from '../../../src/track/geo';
import type { RunoffSegment, TrackSegment } from '../../../src/core/types';

function circle(R: number): Point2[] {
  const n = Math.round(Math.PI * R);
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)];
  });
}

// Annular sector between the centerline angles of indices i0..i1, from r0 to r1 beyond R.
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

// Clockwise stadium: 400 m straight, 180° arc of radius R, straight, arc; right turns (as 026).
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

const tmp = mkdtempSync(join(tmpdir(), 'osm-runoffs-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function areasFile(features: object[]): string {
  const path = join(tmp, `areas-${features.length}-${Math.floor(performance.now() * 1000)}.json`);
  writeFileSync(path, JSON.stringify({ source: 'OpenStreetMap contributors, ODbL', features }));
  return path;
}

describe('098 OSM run-offs edge cases', () => {
  it('loadGravelPolygons returns [] for a missing file', () => {
    expect(loadGravelPolygons(join(tmp, 'nope.json'), [0, 0])).toEqual([]);
  });

  it('loadGravelPolygons keeps only closed sand/shingle/gravel rings, projected with the origin', () => {
    const origin: LonLat = [9.3, 45.6];
    const ring: LonLat[] = [[9.301, 45.601], [9.302, 45.601], [9.302, 45.602], [9.301, 45.601]];
    const path = areasFile([
      { id: 1, kind: 'grass', closed: true, tags: { landuse: 'grass' }, ring },
      { id: 2, kind: 'barrier', closed: true, tags: { barrier: 'wall' }, ring },
      { id: 3, kind: 'gravel', closed: false, tags: { natural: 'sand' }, ring },
      { id: 4, kind: 'gravel-line', closed: true, tags: { surface: 'asphalt' }, ring },
      { id: 5, kind: 'sand', closed: true, tags: { natural: 'sand' }, ring },
      { id: 6, kind: 'shingle', closed: true, tags: { natural: 'shingle', surface: 'gravel' }, ring },
      { id: 7, kind: 'gravel-surface', closed: true, tags: { surface: 'gravel' }, ring },
      { id: 8, kind: 'sand-surface', closed: true, tags: { surface: 'sand' }, ring },
    ]);
    const polys = loadGravelPolygons(path, origin);
    expect(polys).toHaveLength(4);
    for (const p of polys) expect(p).toEqual(projectLonLat(ring, origin));
  });

  it('an OSM crossing shorter than 5 indices is dropped', () => {
    const ring = circle(400);
    const n = ring.length;
    const out = detectRunoffs(ring, [sector(400, n, 100, 103, 408, 428)], 6);
    expect(out).toEqual([]);
  });

  it('the extent is the farthest lateral crossing minus the edge, floored at 4 m', () => {
    const ring = circle(400);
    const n = ring.length;
    // Crossings at 2 m (behind the edge) and 30 m from the centerline: extent = 30 - 6 = 24.
    const wide = detectRunoffs(ring, [sector(400, n, 100, 150, 402, 430)], 6);
    expect(wide).toHaveLength(1);
    expect(wide[0].widthMeters).toBe(24);
    // Crossings at 5 m and 9 m: raw extent 3 clamped up to 4.
    const graze = detectRunoffs(ring, [sector(400, n, 100, 150, 405, 409)], 6);
    expect(graze).toHaveLength(1);
    expect(graze[0].widthMeters).toBe(4);
  });

  it('a width jump of more than 6 m from the run median starts a new run', () => {
    const ring = circle(400);
    const n = ring.length;
    // Extents 24 (indices 100..150) then 4 (151..200): medians differ by 20 > 6.
    const polys = [sector(400, n, 99, 150, 402, 430), sector(400, n, 150, 201, 401, 410)];
    const out = detectRunoffs(ring, polys, 6);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 100, end: 150, surface: 'gravel', widthMeters: 24 });
    expect(out[1]).toMatchObject({ start: 151, end: 200, surface: 'gravel', widthMeters: 4 });
  });

  it('a run crossing index 0 wraps into a single segment with end < start', () => {
    const ring = circle(400);
    const n = ring.length;
    const out = detectRunoffs(ring, [sector(400, n, n - 20, n + 20, 408, 428)], 6);
    expect(out).toHaveLength(1);
    expect(out[0].end).toBeLessThan(out[0].start);
    expect(out[0].surface).toBe('gravel');
  });

  it('a kerb moves the lateral origin out by KERB_WIDTH, dropping bands inside the kerb', () => {
    const ring = circle(400);
    const n = ring.length;
    // Band 6.3..7.0 m from the centerline: inside the kerb zone (edge 6 + 1.2).
    const band = sector(400, n, 100, 150, 406.3, 407.0);
    const bare = detectRunoffs(ring, [band], 6);
    expect(bare).toHaveLength(1);
    expect(bare[0].widthMeters).toBe(4); // 1 m raw extent floored at 4
    const kerbs: TrackSegment[] = [{ start: 90, end: 160, side: bare[0].side }];
    expect(detectRunoffs(ring, [band], 6, kerbs)).toEqual([]);
  });

  it('an OSM run ending within 15 indices of the fallback span still suppresses it', () => {
    const pts = stadium(90, 142);
    // Band on the left of the first straight (outside of the first right turn), 12..30 m out.
    const band: Point2[] = [[120, -102], [166, -102], [166, -120], [120, -120]];
    const out = detectRunoffs(pts, [band], 6);
    const firstTurn = out.filter((s) => s.side === 'left');
    // The first turn's own fallback ([86, 257]) is suppressed: the OSM run ends 3 indices short of it.
    expect(firstTurn).toHaveLength(2);
    expect(firstTurn[0]).toMatchObject({ start: 60, end: 83, side: 'left', surface: 'gravel', widthMeters: 24 });
    expect(firstTurn[1]).toMatchObject({ surface: 'gravel', widthMeters: 18 });
    expect(out.length).toBe(2);
  });

  it('an OSM run on the opposite side does not suppress the fallback', () => {
    const pts = stadium(90, 142);
    // Same band but on the right of the first straight (inside of the first turn).
    const band: Point2[] = [[120, -78], [166, -78], [166, -60], [120, -60]];
    const out = detectRunoffs(pts, [band], 6);
    const rightSide = out.filter((s) => s.side === 'right');
    expect(rightSide).toHaveLength(1);
    expect(rightSide[0].surface).toBe('gravel');
    expect(out.length).toBe(3); // inside OSM run + both turn fallbacks
  });

  it('output is deterministic and sorted by start', () => {
    const ring = circle(400);
    const n = ring.length;
    const polys = [sector(400, n, 100, 150, 408, 428), sector(400, n, 300, 380, 402, 430)];
    const a: RunoffSegment[] = detectRunoffs(ring, polys, 6);
    const b: RunoffSegment[] = detectRunoffs(ring, polys, 6);
    expect(a).toEqual(b);
    expect(a.map((s) => s.start)).toEqual([...a.map((s) => s.start)].sort((x, y) => x - y));
  });
});

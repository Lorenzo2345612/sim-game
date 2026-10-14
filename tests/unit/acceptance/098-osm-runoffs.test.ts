import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectRunoffs as detectRunoffsImpl } from '../../../tools/track-builder/corners';
import { loadGravelPolygons } from '../../../tools/track-builder/osmAreas';
import { bboxCenter, type LonLat, type Point2 } from '../../../src/track/geo';
import type { RunoffSegment, Side, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';

// Spec-098 signature; typed locally so this test-first file compiles against the current 1-arg implementation.
type DetectRunoffs = (points: Point2[], gravel?: Point2[][], halfWidth?: number, kerbs?: TrackSegment[]) => RunoffSegment[];
const detectRunoffs = detectRunoffsImpl as DetectRunoffs;

const ROOT = join(__dirname, '..', '..', '..');
const IDS = ['monza', 'spa', 'silverstone'];

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

// ~2 m spacing; same parametrisation as the circle helper in 026.
function circle(R: number): Point2[] {
  const n = Math.round(Math.PI * R);
  return Array.from({ length: n }, (_, k): Point2 => {
    const a = (2 * Math.PI * k) / n;
    return [R * Math.cos(a), -R * Math.sin(a)];
  });
}

// Turn-side convention of corners.ts: cross < 0 -> 'left'; run-off sits on the opposite side.
function outerSideOf(points: Point2[], i: number): Side {
  const n = points.length;
  const p = points[(i - 5 + n) % n];
  const c = points[i];
  const q = points[(i + 5) % n];
  const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
  return cross < 0 ? 'right' : 'left';
}

function covers(seg: TrackSegment, i: number, n: number): boolean {
  const s = ((seg.start % n) + n) % n;
  const e = ((seg.end % n) + n) % n;
  const len = ((e - s + n) % n) + 1;
  return ((i - s + n) % n) < len;
}

function hasCoveredIndex(seg: TrackSegment, n: number, pred: (i: number) => boolean): boolean {
  const s = ((seg.start % n) + n) % n;
  const len = ((seg.end - seg.start + n) % n) + 1;
  for (let k = 0; k < len; k++) if (pred((s + k) % n)) return true;
  return false;
}

// Menger circumradius of [i-3, i, i+3], per AT3's "Menger, +-3 points".
function mengerAt(cx: Point2[], i: number): number {
  const n = cx.length;
  const a = cx[(i - 3 + n) % n];
  const b = cx[i];
  const c = cx[(i + 3) % n];
  const abx = b[0] - a[0], abz = b[1] - a[1];
  const acx = c[0] - a[0], acz = c[1] - a[1];
  const cross = Math.abs(abx * acz - abz * acx);
  if (cross === 0) return Infinity;
  return (Math.hypot(abx, abz) * Math.hypot(c[0] - b[0], c[1] - b[1]) * Math.hypot(acx, acz)) / (2 * cross);
}

function rightNormalAt(cx: Point2[], i: number): Point2 {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

function segmentsIntersect(p: Point2, q: Point2, r: Point2, s: Point2): boolean {
  const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
  const u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// AT1 lateral line: from outer edge (half + KERB_WIDTH under a kerb, else half) out to half + 40.
function lateralCrossesGravel(track: TrackDataV2, polys: Point2[][], seg: RunoffSegment, i: number): boolean {
  const n = track.centerline.length;
  const half = track.widthMeters / 2;
  const kerb = track.kerbs.some((k) => k.side === seg.side && covers(k, i, n));
  const edge = half + (kerb ? KERB_WIDTH : 0);
  const sign = seg.side === 'right' ? 1 : -1;
  const [rx, rz] = rightNormalAt(track.centerline, i);
  const c = track.centerline[i];
  const p: Point2 = [c[0] + rx * sign * edge, c[1] + rz * sign * edge];
  const q: Point2 = [c[0] + rx * sign * (half + 40), c[1] + rz * sign * (half + 40)];
  for (const ring of polys) {
    for (let k = 0; k < ring.length; k++) {
      if (segmentsIntersect(p, q, ring[k], ring[(k + 1) % ring.length])) return true;
    }
  }
  return false;
}

describe('098 OSM run-offs acceptance', () => {
  it('AT1: a gravel polygon hugging the outside of an R 400 ring yields exactly one outer gravel run-off (start 100 +-1, end 200 +-1, width 22 +-1) and no fallback run-offs', () => {
    const R = 400;
    const ring = circle(R); // n = 1257
    const a1 = (2 * Math.PI * 100) / ring.length;
    const a2 = (2 * Math.PI * 200) / ring.length;
    const sector: Point2[] = [];
    const steps = 32;
    for (let k = 0; k <= steps; k++) {
      const a = a1 + ((a2 - a1) * k) / steps;
      sector.push([408 * Math.cos(a), -408 * Math.sin(a)]);
    }
    for (let k = steps; k >= 0; k--) {
      const a = a1 + ((a2 - a1) * k) / steps;
      sector.push([428 * Math.cos(a), -428 * Math.sin(a)]);
    }
    sector.push(sector[0]);
    const out = detectRunoffs(ring, [sector], 6);
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.side).toBe(outerSideOf(ring, 150));
    expect(s.surface).toBe('gravel');
    expect(Math.abs(s.start - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.end - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.widthMeters - 22)).toBeLessThanOrEqual(1);
  });

  it('AT2: without polygons the fallback rule gives R 90 one outer gravel 18 m run-off, R 120 one outer paved runoff 12 m and R 200 none', () => {
    const r90 = detectRunoffs(circle(90));
    expect(r90).toHaveLength(1);
    expect(r90[0].side).toBe(outerSideOf(circle(90), 50));
    expect(r90[0].surface).toBe('gravel');
    expect(r90[0].widthMeters).toBeCloseTo(18, 9);

    const r120 = detectRunoffs(circle(120));
    expect(r120).toHaveLength(1);
    expect(r120[0].side).toBe(outerSideOf(circle(120), 50));
    expect(r120[0].surface).toBe('runoff');
    expect(r120[0].widthMeters).toBeCloseTo(12, 9);

    expect(detectRunoffs(circle(200))).toHaveLength(0);
  });

  it('AT3: in the rebuilt tracks every paved run-off contains an index whose centerline Menger radius (+-3 points) is < 150 m, and Monza has no paved run-off overlapping indices 369..733', () => {
    const failures: string[] = [];
    for (const id of IDS) {
      const track = loadTrack(id);
      const n = track.centerline.length;
      const r = track.centerline.map((_, i) => mengerAt(track.centerline, i));
      for (const seg of track.runoffs) {
        if (seg.surface !== 'runoff') continue;
        if (!hasCoveredIndex(seg, n, (i) => r[i] < 150)) {
          failures.push(`${id} paved run-off [${seg.start},${seg.end}] has no index with radius < 150`);
        }
        if (id === 'monza' && hasCoveredIndex(seg, n, (i) => i >= 369 && i <= 733)) {
          failures.push(`monza paved run-off [${seg.start},${seg.end}] overlaps 369..733`);
        }
      }
    }
    expect(failures.length, failures.slice(0, 10).join('; ')).toBe(0);
  });

  it('AT4: the rebuilt Monza has >= 8 gravel segments and each one overlaps an OSM gravel polygon (lateral line test) or a corner with radius < 100 m', () => {
    const track = loadTrack('monza');
    const n = track.centerline.length;
    const geojson = JSON.parse(
      readFileSync(join(ROOT, 'assets', 'source', 'tracks', 'it-1922.geojson'), 'utf8'),
    ) as { features: { geometry: { coordinates: LonLat[] } }[] };
    const origin = bboxCenter(geojson.features[0].geometry.coordinates);
    const polys = loadGravelPolygons(join(ROOT, 'assets', 'source', 'osm', 'monza-areas.json'), origin);
    const gravel = track.runoffs.filter((s) => s.surface === 'gravel');
    expect(gravel.length).toBeGreaterThanOrEqual(8);
    const unexplained = gravel
      .filter((seg) => !hasCoveredIndex(seg, n, (i) => mengerAt(track.centerline, i) < 100 || lateralCrossesGravel(track, polys, seg, i)))
      .map((seg) => `[${seg.start},${seg.end}] ${seg.side}`);
    expect(unexplained.length, `gravel run-offs explained by neither OSM nor a < 100 m corner: ${unexplained.slice(0, 10).join('; ')}`).toBe(0);
  }, 120000);

  it('AT5: the rebuilt tracks keep centerline, elevation, kerbs and pit identical to the pre-task JSON', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    for (const id of IDS) {
      const now = loadTrack(id);
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      for (const key of ['centerline', 'elevation', 'pit'] as const) {
        expect(now[key], `${id}: ${key} changed`).toEqual(prev[key]);
      }
    }
  }, 120000);
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, Side, TrackDataV2 } from '../../../src/core/types';
import { detectCorners } from '../../../tools/track-builder/corners';
import {
  applyFoamBarriers,
  applyPavedRunoffs,
  classifyCorners,
  detectEscapeRoads,
} from '../../../tools/track-builder/hazards';
import type { BrakingCorner } from '../../../tools/track-builder/hazards';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const wrap = (v: number, n: number) => ((v % n) + n) % n;
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const corner = (
  start: number, end: number, side: Side, minRadius: number, dropKmh: number,
  kind: BrakingCorner['kind'],
): BrakingCorner => ({ start, end, side, minRadius, dropKmh, kind });
const line = (n: number): Point2[] => Array.from({ length: n }, (_, i): Point2 => [2 * i, 0]);
const circle = (R: number, n: number): Point2[] =>
  Array.from({ length: n }, (_, i): Point2 => {
    const a = (2 * Math.PI * i) / n;
    return [R * Math.cos(a), R * Math.sin(a)];
  });

function arcLen(points: Point2[], a: number, b: number): number {
  const n = points.length;
  let d = 0;
  for (let i = wrap(a, n); i !== wrap(b, n); i = (i + 1) % n) {
    const j = (i + 1) % n;
    d += Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
  }
  return d;
}

// Chicane: 500 m straight, arc R1/s1 60 deg, `mid` straight, arc R2/s2 60 deg,
// 500 m straight, closed by a loop of R300 quarter arcs.
function chicane(R1: number, s1: number, R2: number, s2: number, mid: number): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let px = 0;
  let pz = 0;
  let phi = -Math.PI / 2;
  const straight = (m: number): void => {
    let d = m;
    while (d > 1e-9) {
      const s = Math.min(2, d);
      d -= s;
      px += s * Math.cos(phi);
      pz += s * Math.sin(phi);
      pts.push([px, pz]);
    }
  };
  const arc = (R: number, deg: number, s: number): void => {
    const span = (deg * Math.PI) / 180;
    const k = Math.max(1, Math.ceil((R * span) / 2));
    const cx = px + s * R * -Math.sin(phi);
    const cz = pz + s * R * Math.cos(phi);
    const vx = px - cx;
    const vz = pz - cz;
    for (let j = 1; j <= k; j++) {
      const th = (s * span * j) / k;
      px = cx + vx * Math.cos(th) - vz * Math.sin(th);
      pz = cz + vx * Math.sin(th) + vz * Math.cos(th);
      pts.push([px, pz]);
    }
    phi += s * span;
  };
  straight(500); arc(R1, 60, s1); straight(mid); arc(R2, 60, s2); straight(500);
  const phi0 = phi;
  const dx = -px;
  const dz = -pz;
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  arc(300, 90, 1); straight(Math.max(along(phi0 + Math.PI / 2), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + Math.PI), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + (3 * Math.PI) / 2), 0));
  arc(300, 90, 1); straight(Math.max(along(phi0 + 2 * Math.PI), 0));
  if (Math.hypot(px, pz) < 1e-6) pts.pop();
  return pts;
}

describe('140 post: gaps in paved run-offs, foam, classify, escape roads, parser, rebuilt tracks', () => {
  it('POST1: empty and short (n < 3) inputs return empty or unchanged results without throwing', () => {
    expect(classifyCorners([])).toEqual([]);
    expect(classifyCorners([[0, 0], [2, 0]])).toEqual([]);
    expect(detectEscapeRoads([])).toEqual([]);
    expect(detectEscapeRoads([[0, 0], [2, 0]])).toEqual([]);
    expect(applyFoamBarriers([], [corner(5, 10, 'left', 50, 90, 'heavy')])).toEqual([]);
    const seg: RunoffSegment = { start: 0, end: 1, side: 'right', surface: 'gravel', widthMeters: 12 };
    const short = applyPavedRunoffs([[0, 0], [2, 0]], [seg], [corner(0, 1, 'left', 50, 90, 'heavy')]);
    expect(short).toEqual([seg]);
    expect(applyPavedRunoffs([], [], [])).toEqual([]);
  });

  it('POST2: a single corner run uses the rest of the lap (closing edge) as approach and yields no escape road; no runs gives no corners', () => {
    const pts = circle(30, 94);
    const snapshot = JSON.stringify(pts);
    const runs = detectCorners(pts);
    expect(runs).toHaveLength(1);
    const corners = classifyCorners(pts);
    expect(JSON.stringify(pts)).toBe(snapshot);
    expect(corners).toHaveLength(1);
    const c = corners[0];
    const L = arcLen(pts, runs[0].end, runs[0].start);
    const vc = Math.min(85, Math.sqrt(1.6 * 9.81 * c.minRadius));
    expect(c.dropKmh).toBeCloseTo(3.6 * (Math.min(85, Math.sqrt(vc * vc + 2 * 12 * L)) - vc), 6);
    expect(c.kind).toBe('none');
    expect(detectEscapeRoads(pts)).toEqual([]);
    expect(classifyCorners(circle(500, 200))).toEqual([]);
  });

  it('POST3: no escape road when the tight pair turns to the same side or when one run has minRadius >= 80, even with a gap below 120 m', () => {
    const same = chicane(40, -1, 40, -1, 50);
    const sameRuns = detectCorners(same);
    expect(sameRuns[0].minRadius).toBeLessThan(80);
    expect(sameRuns[1].minRadius).toBeLessThan(80);
    expect(sameRuns[0].side).toBe(sameRuns[1].side);
    expect(arcLen(same, sameRuns[0].end, sameRuns[1].start)).toBeLessThan(120);
    expect(detectEscapeRoads(same)).toEqual([]);

    const wide = chicane(40, -1, 100, 1, 50);
    const wideRuns = detectCorners(wide);
    expect(wideRuns[0].minRadius).toBeLessThan(80);
    expect(wideRuns[1].minRadius).toBeGreaterThanOrEqual(80);
    expect(wideRuns[0].side).not.toBe(wideRuns[1].side);
    expect(arcLen(wide, wideRuns[0].end, wideRuns[1].start)).toBeLessThan(120);
    expect(detectEscapeRoads(wide)).toEqual([]);
  });

  it('POST4: an escape-road pair straddling the start/finish seam is detected with A and B at the wrapped indices', () => {
    const base = chicane(40, -1, 40, 1, 50);
    const baseRuns = detectCorners(base);
    const k = baseRuns[0].end + 5;
    const pts = [...base.slice(k), ...base.slice(0, k)];
    const n = pts.length;
    const runs = detectCorners(pts);
    const first = runs[0];
    const last = runs[runs.length - 1];
    expect(first.side).not.toBe(last.side);
    expect(first.minRadius).toBeLessThan(80);
    expect(last.minRadius).toBeLessThan(80);
    expect(arcLen(pts, last.end, first.start)).toBeLessThan(120);
    const roads = detectEscapeRoads(pts);
    expect(roads).toHaveLength(1);
    expect(roads[0].width).toBeCloseTo(8, 9);
    const A = pts[wrap(last.start - 10, n)];
    const B = pts[first.end];
    const p = roads[0].points;
    expect(dist(p[0], A)).toBeLessThanOrEqual(1e-6);
    expect(dist(p[p.length - 1], B)).toBeLessThanOrEqual(1e-6);
    for (let i = 1; i < p.length; i++) expect(dist(p[i], p[i - 1])).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('POST5: a heavy corner foams the outside barrier regardless of offsetMeters and equal-type ends re-merge across index 0', () => {
    const barriers: BarrierSegment[] = [
      { start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: 25 },
    ];
    const out = applyFoamBarriers(barriers, [corner(40, 60, 'left', 50, 90, 'heavy')]);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ start: 25, end: 70, side: 'right', type: 'foam', offsetMeters: 25 });
    expect(out).toContainEqual({ start: 71, end: 24, side: 'right', type: 'armco', offsetMeters: 25 });
  });

  it('POST6: kind none foams nothing and applyFoamBarriers still normalizes and merges equal segments', () => {
    const barriers: BarrierSegment[] = [
      { start: 0, end: 30, side: 'right', type: 'armco', offsetMeters: 9 },
      { start: 31, end: 60, side: 'right', type: 'wall', offsetMeters: 9 },
      { start: 61, end: 99, side: 'right', type: 'armco', offsetMeters: 9 },
    ];
    const out = applyFoamBarriers(barriers, [corner(40, 50, 'left', 300, 10, 'none')]);
    expect(out.filter((b) => b.type === 'foam')).toHaveLength(0);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ start: 31, end: 60, side: 'right', type: 'wall', offsetMeters: 9 });
    expect(out).toContainEqual({ start: 61, end: 30, side: 'right', type: 'armco', offsetMeters: 9 });
  });

  it('POST7: the lap size is inferred from corners too, so a foam span wrapping past the barrier coverage ends at max index + 1', () => {
    const barriers: BarrierSegment[] = [
      { start: 0, end: 50, side: 'right', type: 'armco', offsetMeters: 9 },
    ];
    const out = applyFoamBarriers(barriers, [corner(45, 60, 'left', 50, 90, 'heavy')]);
    expect(out).toHaveLength(3);
    expect(out).toContainEqual({ start: 0, end: 9, side: 'right', type: 'foam', offsetMeters: 9 });
    expect(out).toContainEqual({ start: 10, end: 29, side: 'right', type: 'armco', offsetMeters: 9 });
    expect(out).toContainEqual({ start: 30, end: 50, side: 'right', type: 'foam', offsetMeters: 9 });
  });

  it('POST8: medium and none corners neither remove nor add run-offs and equal starts keep input order', () => {
    const gravel: RunoffSegment = { start: 40, end: 80, side: 'right', surface: 'gravel', widthMeters: 12 };
    const left: RunoffSegment = { start: 75, end: 90, side: 'left', surface: 'gravel', widthMeters: 12 };
    const out = applyPavedRunoffs(line(200), [gravel, left], [
      corner(60, 70, 'left', 130, 50, 'medium'),
      corner(150, 160, 'right', 300, 10, 'none'),
    ]);
    expect(out).toEqual([gravel, left]);
    const tie = applyPavedRunoffs(line(200), [left], [corner(100, 120, 'left', 60, 90, 'heavy')]);
    expect(tie).toHaveLength(2);
    expect(tie[0]).toEqual(left);
    expect(tie[1]).toEqual({ start: 75, end: 130, side: 'right', surface: 'runoff', widthMeters: 19 });
  });

  it('POST9: paved width rounds to the 0.5 m grid half-up', () => {
    const out = applyPavedRunoffs(line(400), [], [
      corner(100, 120, 'left', 60, 72.5, 'heavy'),
      corner(200, 220, 'left', 60, 72.4, 'heavy'),
      corner(300, 320, 'left', 60, 250, 'heavy'),
    ]);
    expect(out.map((r) => r.widthMeters)).toEqual([17.5, 17, 30]);
  });

  it('POST10: parseTrackData passes v1 through untouched, validates barrier types on any version and never mutates the input', () => {
    const v1 = {
      version: 1,
      centerline: [],
      barriers: [{ start: 0, end: 3, side: 'left', type: 'armco', offsetMeters: 12 }],
    };
    const out = parseTrackData(v1);
    expect(out).toEqual(v1);
    expect('escapeRoads' in out).toBe(false);
    expect(() => parseTrackData([])).toThrow();
    expect(() => parseTrackData({ barriers: [{ start: 0, end: 1, side: 'left', type: 'wood', offsetMeters: 9 }] })).toThrow();
    const noBarriers = parseTrackData({ version: 2, barriers: 'none' }) as TrackDataV2;
    expect(noBarriers.escapeRoads).toEqual([]);
    const roads: { points: [number, number][]; width: number }[] = [
      { points: [[0, 0], [3, 4], [9, 2]], width: 8 },
    ];
    const kept = parseTrackData({ version: 2, escapeRoads: roads }) as TrackDataV2;
    expect(kept.escapeRoads).toEqual(roads);
    const bare: Record<string, unknown> = { version: 2 };
    parseTrackData(bare);
    expect('escapeRoads' in bare).toBe(false);
  });

  it('POST11: every rebuilt track has an escapeRoads array, valid barrier types, 0.5-grid paved widths and sane escape roads', () => {
    const ids = (
      JSON.parse(readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8')) as { id: string }[]
    ).map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      const track = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as {
        version: number;
        escapeRoads?: { points: [number, number][]; width: number }[];
        barriers: { type: string }[];
        runoffs: { surface: string; widthMeters: number }[];
      };
      expect(track.version, `${id}: version`).toBe(2);
      expect(Array.isArray(track.escapeRoads), `${id}: escapeRoads array`).toBe(true);
      for (const b of track.barriers) {
        expect(['armco', 'tyres', 'wall', 'foam'], `${id}: barrier type ${b.type}`).toContain(b.type);
      }
      for (const r of track.runoffs) {
        if (r.surface !== 'runoff') continue;
        expect(r.widthMeters, `${id}: paved width`).toBeGreaterThanOrEqual(10);
        expect(r.widthMeters, `${id}: paved width`).toBeLessThanOrEqual(30);
        expect((r.widthMeters * 2) % 1, `${id}: paved width grid`).toBeCloseTo(0, 9);
      }
      for (const e of track.escapeRoads ?? []) {
        expect(e.width, `${id}: escape width`).toBe(8);
        expect(e.points.length, `${id}: escape points`).toBeGreaterThanOrEqual(2);
        for (const p of e.points) {
          expect(p, `${id}: escape point`).toHaveLength(2);
          expect(Number.isFinite(p[0]) && Number.isFinite(p[1]), `${id}: escape point finite`).toBe(true);
        }
      }
    }
  }, 120000);
});

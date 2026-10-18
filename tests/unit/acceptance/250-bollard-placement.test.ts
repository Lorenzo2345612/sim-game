import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, Sausage, Side, TrackDataV2 } from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';
import { halfWidthAt } from '../../../src/track/surfaces';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { detectCorners, radii, type CornerRun } from '../../../tools/track-builder/corners';

const ROOT = join(__dirname, '..', '..', '..');

// Variable specifiers keep typecheck green until task 250 adds the exports (the 159 pattern).
const BOLLARDS_MODULE = '../../../tools/track-builder/bollards';
const SAUSAGES_MODULE = '../../../tools/track-builder/sausages';

interface Bollard {
  x: number;
  z: number;
  index: number;
  side: Side;
}

type BuildBollardsFn = (
  points: Point2[],
  halfWidths: { left: number[]; right: number[] } | undefined,
  sausages: Sausage[],
  runoffs: RunoffSegment[],
  barriers: BarrierSegment[],
) => Bollard[];

type ApexIndexFn = (rs: number[], run: CornerRun, n: number) => number;

async function loadBuildBollards(): Promise<BuildBollardsFn> {
  const mod = (await import(BOLLARDS_MODULE)) as unknown as { buildBollards: BuildBollardsFn };
  return mod.buildBollards;
}

async function loadApexIndex(): Promise<ApexIndexFn> {
  const mod = (await import(SAUSAGES_MODULE)) as unknown as { apexIndex: ApexIndexFn };
  return mod.apexIndex;
}

// Closed stadium: straight A (0,0)->(200,0) every 2 m (endpoint excluded), left semicircle
// centred (200,-R), straight B (200,-2R)->(0,-2R) every 2 m, left semicircle centred (0,-R);
// m = max(12, ceil(pi*R)) points per arc at angles pi*j/m, arc endpoints excluded.
function stadiumPoints(R: number): Point2[] {
  const pts: Point2[] = [];
  for (let x = 0; x < 200; x += 2) pts.push([x, 0]);
  const m = Math.max(12, Math.ceil(Math.PI * R));
  for (let j = 0; j < m; j++) {
    const a = Math.PI / 2 - (Math.PI * j) / m;
    pts.push([200 + R * Math.cos(a), -R + R * Math.sin(a)]);
  }
  for (let x = 200; x > 0; x -= 2) pts.push([x, -2 * R]);
  for (let j = 0; j < m; j++) {
    const a = -Math.PI / 2 - (Math.PI * j) / m;
    pts.push([R * Math.cos(a), -R + R * Math.sin(a)]);
  }
  return pts;
}

// Closed box: four straights every 2 m (endpoint excluded) joined by four quarter circles,
// m = max(6, ceil(pi*R/2)) points per quarter at angles pi/2*j/m; left turns, centres in order.
function boxPoints(R: number): Point2[] {
  const pts: Point2[] = [];
  for (let x = 0; x < 200; x += 2) pts.push([x, 0]);
  const m = Math.max(6, Math.ceil((Math.PI * R) / 2));
  const quarter = (cx: number, cz: number, a0: number): void => {
    for (let j = 0; j < m; j++) {
      const a = a0 - (Math.PI / 2) * (j / m);
      pts.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]);
    }
  };
  quarter(200, -R, Math.PI / 2);
  for (let z = -R; z > -R - 200; z -= 2) pts.push([200 + R, z]);
  quarter(200, -R - 200, 0);
  for (let x = 200; x > 0; x -= 2) pts.push([x, -2 * R - 200]);
  quarter(0, -R - 200, -Math.PI / 2);
  for (let z = -R - 200; z < -R; z += 2) pts.push([-R, z]);
  quarter(0, -R, Math.PI);
  return pts;
}

const BOX20_CENTRES: Point2[] = [[200, -20], [200, -220], [0, -220], [0, -20]];

function cumArcs(points: Point2[]): { cum: number[]; lap: number } {
  const n = points.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

// Arc position of the projection of (x,z) onto the centerline polyline.
function projectArc(points: Point2[], x: number, z: number): number {
  const { cum, lap } = cumArcs(points);
  const n = points.length;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * Math.sqrt(len2);
    }
  }
  return best % lap;
}

function arcDist(a: number, b: number, lap: number): number {
  const d = Math.abs(a - b) % lap;
  return Math.min(d, lap - d);
}

function distToPolyline(points: Point2[], x: number, z: number): number {
  let best = Infinity;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    best = Math.min(best, Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t)));
  }
  return best;
}

function nearestSample(points: Point2[], x: number, z: number): { index: number; dist: number } {
  let index = 0;
  let dist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - x, points[i][1] - z);
    if (d < dist) {
      dist = d;
      index = i;
    }
  }
  return { index, dist };
}

function assignGroups(centres: Point2[], bollards: Bollard[]): Bollard[][] {
  const groups: Bollard[][] = centres.map(() => []);
  for (const b of bollards) {
    let best = 0;
    let bestD = Infinity;
    centres.forEach((c, j) => {
      const d = Math.hypot(b.x - c[0], b.z - c[1]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    groups[best].push(b);
  }
  return groups;
}

function byArc(points: Point2[], group: Bollard[]): Bollard[] {
  return [...group].sort(
    (a, b) => projectArc(points, a.x, a.z) - projectArc(points, b.x, b.z),
  );
}

let trackCache: Array<{ id: string; track: TrackDataV2 }> | null = null;

function builtTracks(): Array<{ id: string; track: TrackDataV2 }> {
  if (trackCache) return trackCache;
  const index = JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
  ) as Array<{ id: string }>;
  trackCache = index.map(({ id }) => ({
    id,
    track: JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
    ) as TrackDataV2,
  }));
  return trackCache;
}

describe('250 bollard placement acceptance', () => {
  it('AT1: BOX(20) buildBollards places 12 bollards, all left, 3 per corner with the middle one 11.8 +- 0.3 from the corner centre and the outer two 4 +- 0.3 m arc from it', async () => {
    const buildBollards = await loadBuildBollards();
    const points = boxPoints(20);
    const out = buildBollards(points, undefined, [], [], []);
    expect(out).toHaveLength(12);
    expect(out.every((b) => b.side === 'left'), 'all sides left').toBe(true);
    const { lap } = cumArcs(points);
    const groups = assignGroups(BOX20_CENTRES, out);
    groups.forEach((group, j) => {
      expect(group, `corner ${j} has 3 bollards`).toHaveLength(3);
      const [before, middle, after] = byArc(points, group);
      const d = Math.hypot(
        middle.x - BOX20_CENTRES[j][0],
        middle.z - BOX20_CENTRES[j][1],
      );
      expect(Math.abs(d - 11.8), `corner ${j} middle distance ${d}`).toBeLessThanOrEqual(0.3);
      for (const outer of [before, after]) {
        const arc = arcDist(
          projectArc(points, outer.x, outer.z),
          projectArc(points, middle.x, middle.z),
          lap,
        );
        expect(Math.abs(arc - 4), `corner ${j} outer arc ${arc}`).toBeLessThanOrEqual(0.3);
      }
    });
  });

  it('AT2: STADIUM(30) buildBollards yields 0 bollards (theta 180 deg, no runoff, no sausage)', async () => {
    const buildBollards = await loadBuildBollards();
    const out = buildBollards(stadiumPoints(30), undefined, [], [], []);
    expect(out).toHaveLength(0);
  });
});

describe('250 bollard placement acceptance — run-off and sausage groups', () => {
  it('AT3: STADIUM(30) with a left run-off covering bend 1, width 12, yields 3 bollards all left within 10 m arc of the bend 1 apex and none near the bend 2 apex', async () => {
    const buildBollards = await loadBuildBollards();
    const apexIndex = await loadApexIndex();
    const points = stadiumPoints(30);
    const runs = detectCorners(points);
    expect(runs).toHaveLength(2);
    const runoffs: RunoffSegment[] = [{
      start: runs[0].start,
      end: runs[0].end,
      side: 'left',
      surface: 'runoff',
      widthMeters: 12,
    }];
    const out = buildBollards(points, undefined, [], runoffs, []);
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.side === 'left'), 'all sides left').toBe(true);
    const { cum, lap } = cumArcs(points);
    const rs = radii(points);
    const apex1 = cum[apexIndex(rs, runs[0], points.length)];
    const apex2 = cum[apexIndex(rs, runs[1], points.length)];
    for (const b of out) {
      const arc = projectArc(points, b.x, b.z);
      expect(arcDist(arc, apex1, lap), `bollard ${b.index} near bend 1 apex`).toBeLessThanOrEqual(10);
      expect(arcDist(arc, apex2, lap), `bollard ${b.index} near bend 2 apex`).toBeGreaterThan(10);
    }
  });

  it('AT4: the AT3 run-off with width 8 yields 0 bollards', async () => {
    const buildBollards = await loadBuildBollards();
    const points = stadiumPoints(30);
    const runs = detectCorners(points);
    const runoffs: RunoffSegment[] = [{
      start: runs[0].start,
      end: runs[0].end,
      side: 'left',
      surface: 'runoff',
      widthMeters: 8,
    }];
    const out = buildBollards(points, undefined, [], runoffs, []);
    expect(out).toHaveLength(0);
  });

  it('AT5: STADIUM(30) with a left sausage at the bend 1 apex (offset 7.8, length 10) yields 3 bollards at lateral 7.8 +- 0.05 and arcs apex + 7, + 9, + 11 m (+- 0.5)', async () => {
    const buildBollards = await loadBuildBollards();
    const apexIndex = await loadApexIndex();
    const points = stadiumPoints(30);
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const sausages: Sausage[] = [{ index: apex, side: 'left', offset: 7.8, length: 10 }];
    const out = buildBollards(points, undefined, sausages, [], []);
    expect(out).toHaveLength(3);
    const { cum } = cumArcs(points);
    const apexArc = cum[apex];
    const deltas = out
      .map((b) => projectArc(points, b.x, b.z) - apexArc)
      .sort((a, b) => a - b);
    expect(deltas).toHaveLength(3);
    [7, 9, 11].forEach((want, k) => {
      expect(Math.abs(deltas[k] - want), `arc apex + ${deltas[k]}`).toBeLessThanOrEqual(0.5);
    });
    for (const b of out) {
      const lateral = distToPolyline(points, b.x, b.z);
      expect(Math.abs(lateral - 7.8), `bollard ${b.index} lateral ${lateral}`).toBeLessThanOrEqual(0.05);
    }
  });

  it('AT6: BOX(20) with a left sausage at corner 1 apex (offset 7.8, length 10) yields 12 bollards: corner 1 only the sausage group at lateral 7.8, corners 2-4 the R2 groups', async () => {
    const buildBollards = await loadBuildBollards();
    const apexIndex = await loadApexIndex();
    const points = boxPoints(20);
    const runs = detectCorners(points);
    expect(runs).toHaveLength(4);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const sausages: Sausage[] = [{ index: apex, side: 'left', offset: 7.8, length: 10 }];
    const out = buildBollards(points, undefined, sausages, [], []);
    expect(out).toHaveLength(12);
    expect(out.every((b) => b.side === 'left'), 'all sides left').toBe(true);
    const { lap } = cumArcs(points);
    const groups = assignGroups(BOX20_CENTRES, out);
    const corner1 = byArc(points, groups[0]);
    expect(corner1, 'corner 1 count').toHaveLength(3);
    for (const b of corner1) {
      const lateral = distToPolyline(points, b.x, b.z);
      expect(Math.abs(lateral - 7.8), `corner 1 bollard ${b.index} lateral ${lateral}`).toBeLessThanOrEqual(0.05);
    }
    for (let j = 1; j < 4; j++) {
      const group = byArc(points, groups[j]);
      expect(group, `corner ${j + 1} count`).toHaveLength(3);
      const [before, middle, after] = group;
      const d = Math.hypot(
        middle.x - BOX20_CENTRES[j][0],
        middle.z - BOX20_CENTRES[j][1],
      );
      expect(Math.abs(d - 11.8), `corner ${j + 1} middle distance ${d}`).toBeLessThanOrEqual(0.3);
      for (const outer of [before, after]) {
        const arc = arcDist(
          projectArc(points, outer.x, outer.z),
          projectArc(points, middle.x, middle.z),
          lap,
        );
        expect(Math.abs(arc - 4), `corner ${j + 1} outer arc ${arc}`).toBeLessThanOrEqual(0.3);
      }
    }
  });

  it('AT7: BOX(7) buildBollards yields 0 bollards (0.8 * 7 = 5.6 < 8.2)', async () => {
    const buildBollards = await loadBuildBollards();
    const out = buildBollards(boxPoints(7), undefined, [], [], []);
    expect(out).toHaveLength(0);
  });
});

describe('250 bollard placement acceptance — built tracks and parser', () => {
  it('AT8: every built-track bollard has clearance >= halfNear + KERB_WIDTH + 0.5 - 1e-6; totals > 0 with at least 10 tracks carrying bollards', () => {
    let total = 0;
    let tracksWithBollards = 0;
    for (const { id, track } of builtTracks()) {
      const bollards = (track as TrackDataV2 & { bollards?: Bollard[] }).bollards ?? [];
      if (bollards.length > 0) tracksWithBollards += 1;
      total += bollards.length;
      for (const b of bollards) {
        const near = nearestSample(track.centerline, b.x, b.z);
        const halfNear = Math.min(
          halfWidthAt(track, 'left', near.index),
          halfWidthAt(track, 'right', near.index),
        );
        expect(
          near.dist,
          `${id}: bollard at (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) clearance ${near.dist.toFixed(3)}`,
        ).toBeGreaterThanOrEqual(halfNear + KERB_WIDTH + 0.5 - 1e-6);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(tracksWithBollards).toBeGreaterThanOrEqual(10);
  }, 120000);

  it('AT9: rebuilt track JSONs differ from the pre-task JSON only by the added bollards key', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    for (const { id, track } of builtTracks()) {
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      const pin: Record<string, unknown> = { ...track };
      delete pin.bollards;
      expect(pin, `${id}: only bollards added`).toEqual(prev);
    }
  }, 120000);

  it('AT10: parseTrackData on a JSON without bollards defaults bollards to []', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    const json = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${index[0].id}.json`), 'utf8'),
    ) as Record<string, unknown>;
    delete json.bollards;
    const parsed = parseTrackData(json) as TrackDataV2 & { bollards?: Bollard[] };
    expect(parsed.bollards).toEqual([]);
  });
});

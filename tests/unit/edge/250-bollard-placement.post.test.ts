import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, Bollard, RunoffSegment, Sausage, TrackDataV2 } from '../../../src/core/types';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { detectCorners, radii } from '../../../tools/track-builder/corners';
import { apexIndex } from '../../../tools/track-builder/sausages';
import { buildBollards } from '../../../tools/track-builder/bollards';

const ROOT = join(__dirname, '..', '..', '..');

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

// Signed lateral offset of (x, z) from the centerline along the right normal of the
// nearest segment (right = +).
function signedLateral(points: Point2[], x: number, z: number): number {
  const n = points.length;
  let best = Infinity;
  let bestLat = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len = Math.hypot(abx, abz);
    if (len === 0) continue;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / (len * len)));
    const px = a[0] + abx * t;
    const pz = a[1] + abz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestLat = ((x - px) * (-abz / len) + (z - pz) * (abx / len));
    }
  }
  return bestLat;
}

const BOX20_CENTRES: Point2[] = [[200, -20], [200, -220], [0, -220], [0, -20]];

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

describe('250 bollard placement post-code gaps', () => {
  it('POST1: buildBollards leaves every input untouched and repeats deterministically', () => {
    const points = boxPoints(20);
    const halfWidths = { left: points.map(() => 6), right: points.map(() => 4) };
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const sausages: Sausage[] = [{ index: apex, side: 'left', offset: 7.8, length: 10 }];
    const runoffs: RunoffSegment[] = [{ start: runs[1].start, end: runs[1].end, side: 'left', surface: 'runoff', widthMeters: 12 }];
    const barriers: BarrierSegment[] = [{ start: runs[2].start, end: runs[2].end, side: 'right', type: 'armco', offsetMeters: 12 }];
    const snapshot = JSON.stringify({ points, halfWidths, sausages, runoffs, barriers });
    const first = buildBollards(points, halfWidths, sausages, runoffs, barriers);
    expect(JSON.stringify({ points, halfWidths, sausages, runoffs, barriers })).toBe(snapshot);
    const second = buildBollards(points, halfWidths, sausages, runoffs, barriers);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it('POST2: a corner that is both R2 and R3 gets a single group of 3', () => {
    const points = boxPoints(20);
    const runs = detectCorners(points);
    const runoffs: RunoffSegment[] = [
      { start: runs[0].start, end: runs[0].end, side: 'left', surface: 'runoff', widthMeters: 12 },
    ];
    const out = buildBollards(points, undefined, [], runoffs, []);
    expect(out).toHaveLength(12);
    expect(assignGroups(BOX20_CENTRES, out)[0], 'corner 1 keeps one group').toHaveLength(3);
  });

  it('POST3: an R1 bollard drops when its lateral reaches 0.8 of the radius at its index', () => {
    const points = stadiumPoints(30);
    const runs = detectCorners(points);
    expect(runs).toHaveLength(2);
    const rs = radii(points);
    const apex = apexIndex(rs, runs[0], points.length);
    expect(rs[apex], 'apex radius ~30').toBeCloseTo(30, 3);
    const halfWidths = { left: points.map(() => 3), right: points.map(() => 3) };
    const at = (offset: number): Bollard[] =>
      buildBollards(points, halfWidths, [{ index: apex, side: 'left', offset, length: 0 }], [], []);
    const kept = at(23);
    expect(kept, 'lateral 23 < 0.8 * 30').toHaveLength(3);
    for (const b of kept) expect(rs[b.index], 'radius at the kept index').toBeCloseTo(30, 2);
    expect(at(25), 'lateral 25 >= 0.8 * 30 drops').toHaveLength(0);
  });

  it('POST4: the tightest covering barrier on the bollard side decides the drop, including wrapping ranges', () => {
    const points = stadiumPoints(30);
    const n = points.length;
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const sausage: Sausage[] = [{ index: apex, side: 'left', offset: 9, length: 10 }];
    const barrier = (start: number, end: number, offsetMeters: number): BarrierSegment => ({
      start, end, side: 'left', type: 'armco', offsetMeters,
    });
    const build = (bs: BarrierSegment[]): number =>
      buildBollards(points, undefined, sausage, [], bs).length;
    expect(build([barrier(runs[0].start, runs[0].end, 12), barrier(runs[0].start, runs[0].end, 8)]),
      'min offset 8 drops').toBe(0);
    expect(build([barrier(runs[0].start, runs[0].end, 12), barrier(runs[0].start, runs[0].end, 10)]),
      'min offset 10 keeps').toBe(3);
    expect(build([barrier(runs[0].start, runs[0].end, 12), barrier(0, 0, 4)]),
      'barrier not covering the index is ignored').toBe(3);
    expect(build([barrier(n - 5, runs[0].end, 8)]),
      'wrapping range covering the index drops').toBe(0);
    expect(build([barrier(n - 5, runs[0].start, 8)]),
      'wrapping range not covering the index keeps').toBe(3);
    const single = buildBollards(points, undefined, [{ index: apex, side: 'left', offset: 9, length: 0 }], [], []);
    expect(single).toHaveLength(3);
    const drop = single[1].index;
    const one = buildBollards(
      points, undefined, [{ index: apex, side: 'left', offset: 9, length: 0 }], [],
      [barrier(drop, drop, 8)],
    );
    expect(one, 'barrier on one index drops only that bollard').toHaveLength(2);
    expect(one.map((b) => b.index)).not.toContain(drop);
  });

  it('POST5: equal index arcs sort left before right, and the right normal places sides with opposite signs', () => {
    const points = boxPoints(20);
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const out = buildBollards(
      points,
      undefined,
      [
        { index: apex, side: 'left', offset: 7.8, length: 10 },
        { index: apex, side: 'right', offset: 7.8, length: 10 },
      ],
      [], [],
    );
    expect(out, 'left R1 + right R1 at corner 1, R2 at corners 2-4').toHaveLength(15);
    const corner1 = out.filter((b) => Math.hypot(b.x - BOX20_CENTRES[0][0], b.z - BOX20_CENTRES[0][1]) < 30);
    expect(corner1, 'corner 1 holds both R1 groups').toHaveLength(6);
    for (let i = 0; i < corner1.length; i += 2) {
      expect(corner1[i].index, `pair ${i / 2} shares the index`).toBe(corner1[i + 1].index);
      expect(corner1[i].side, `pair ${i / 2} left first`).toBe('left');
      expect(corner1[i + 1].side, `pair ${i / 2} right second`).toBe('right');
    }
    for (const b of corner1) {
      const lat = signedLateral(points, b.x, b.z);
      const want = b.side === 'right' ? 7.8 : -7.8;
      expect(Math.abs(lat - want), `side ${b.side} signed lateral ${lat}`).toBeLessThanOrEqual(0.3);
    }
  });

  it('POST6: two sausages place two R1 groups and each suppresses only its own corner R2', () => {
    const points = boxPoints(20);
    const runs = detectCorners(points);
    const rs = radii(points);
    const sausages: Sausage[] = [
      { index: apexIndex(rs, runs[0], points.length), side: 'left', offset: 7.8, length: 10 },
      { index: apexIndex(rs, runs[1], points.length), side: 'left', offset: 7.8, length: 10 },
    ];
    const out = buildBollards(points, undefined, sausages, [], []);
    expect(out).toHaveLength(12);
    expect(out.every((b) => b.side === 'left'), 'all left').toBe(true);
    const groups = assignGroups(BOX20_CENTRES, out);
    expect(groups[0], 'corner 1 sausage group').toHaveLength(3);
    expect(groups[1], 'corner 2 sausage group').toHaveLength(3);
    expect(groups[2], 'corner 3 keeps its R2').toHaveLength(3);
    expect(groups[3], 'corner 4 keeps its R2').toHaveLength(3);
  });

  it('POST7: a zero-length sausage places its group 2, 4 and 6 m downstream of the sausage index', () => {
    const points = stadiumPoints(30);
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const out = buildBollards(points, undefined, [{ index: apex, side: 'left', offset: 9, length: 0 }], [], []);
    expect(out).toHaveLength(3);
    const { cum, lap } = cumArcs(points);
    const want = [2, 4, 6].map((d) => (cum[apex] + d) % lap);
    const arcs = out.map((b) => projectArc(points, b.x, b.z));
    arcs.forEach((arc, i) => {
      expect(Math.abs(arc - want[i]), `arc ${arc} vs ${want[i]}`).toBeLessThanOrEqual(0.5);
    });
  });

  it('POST11: an R1 group that later drops still suppresses its corner R2 group', () => {
    const points = boxPoints(20);
    const runs = detectCorners(points);
    const apex = apexIndex(radii(points), runs[0], points.length);
    const sausage: Sausage[] = [{ index: apex, side: 'left', offset: 9, length: 10 }];
    const drop: BarrierSegment[] = [{ start: runs[0].start, end: runs[0].end, side: 'left', type: 'armco', offsetMeters: 8 }];
    expect(buildBollards(points, undefined, sausage, [], drop), 'R1 dropped, R2 skipped').toHaveLength(9);
    expect(assignGroups(BOX20_CENTRES, buildBollards(points, undefined, sausage, [], drop))[0], 'corner 1 empty').toHaveLength(0);
    expect(buildBollards(points, undefined, sausage, [], []), 'without the barrier corner 1 keeps the R1').toHaveLength(12);
  });

  it('POST12: an R2 group drops when the inner half-width pushes the lateral to 0.8 of the run minRadius', () => {
    const points = boxPoints(20);
    const wide = { left: points.map(() => 30), right: points.map(() => 6) };
    expect(buildBollards(points, wide, [], [], []), 'lateral 31.2 >= 0.8 * 20').toHaveLength(0);
    const snug = { left: points.map(() => 12), right: points.map(() => 6) };
    expect(buildBollards(points, snug, [], [], []), 'lateral 14.2 < 16').toHaveLength(12);
  });

  it('POST13: mirrored right-hand BOX(20) places its R2 groups on the right side', () => {
    const points = boxPoints(20).map(([x, z]) => [x, -z] as Point2);
    const runs = detectCorners(points);
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.side === 'right'), 'all runs are right-hand').toBe(true);
    const out = buildBollards(points, undefined, [], [], []);
    expect(out).toHaveLength(12);
    expect(out.every((b) => b.side === 'right'), 'all sides right').toBe(true);
    const centres: Point2[] = [[200, 20], [200, 220], [0, 220], [0, 20]];
    assignGroups(centres, out).forEach((group, j) => {
      expect(group, `corner ${j} has 3 bollards`).toHaveLength(3);
      const middle = group[1];
      const d = Math.hypot(middle.x - centres[j][0], middle.z - centres[j][1]);
      expect(Math.abs(d - 11.8), `corner ${j} middle distance ${d}`).toBeLessThanOrEqual(0.3);
    });
  });
});

describe('250 bollard placement post-code gaps — parser and half-width inputs', () => {
  it('POST8: parseTrackData defaults non-array bollards to [] and leaves version 1 alone', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    const json = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${index[0].id}.json`), 'utf8'),
    ) as Record<string, unknown>;
    for (const bad of [null, 7, 'bollards', {}]) {
      const copy: Record<string, unknown> = { ...json, version: 2, bollards: bad };
      const parsed = parseTrackData(copy) as TrackDataV2;
      expect(parsed.bollards, `bollards ${JSON.stringify(bad)}`).toEqual([]);
    }
    const kept = [{ x: 1, z: 2, index: 0, side: 'left' as const }];
    const withBollards = parseTrackData({ ...json, version: 2, bollards: kept }) as TrackDataV2;
    expect(withBollards.bollards).toEqual(kept);
    const v1 = { ...json, version: 1 } as Record<string, unknown>;
    delete v1.bollards;
    const parsedV1 = parseTrackData(v1) as unknown as Record<string, unknown>;
    expect(parsedV1.bollards, 'v1 tracks gain no bollards key').toBeUndefined();
  });

  it('POST9: half-width arrays shorter than the centerline fall back to the 6 m default', () => {
    const points = boxPoints(20);
    const full = buildBollards(points, undefined, [], [], []);
    expect(full).toHaveLength(12);
    expect(buildBollards(points, { left: [], right: [] }, [], [], [])).toEqual(full);
    expect(buildBollards(points, { left: points.map(() => 6), right: [] }, [], [], [])).toEqual(full);
  });
});

describe('250 bollard placement post-code gaps — built track payload', () => {
  it('POST10: built-track bollards are finite, in range, near their index and sorted by index arc', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    let seen = 0;
    for (const { id } of index) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      const bollards = track.bollards ?? [];
      const n = track.centerline.length;
      const { cum, lap } = cumArcs(track.centerline);
      let prev = -Infinity;
      for (const b of bollards) {
        seen += 1;
        expect(Number.isFinite(b.x) && Number.isFinite(b.z), `${id}: finite x/z`).toBe(true);
        expect(Number.isInteger(b.index) && b.index >= 0 && b.index < n, `${id}: index ${b.index}`).toBe(true);
        expect(b.side === 'left' || b.side === 'right', `${id}: side ${b.side}`).toBe(true);
        const proj = projectArc(track.centerline, b.x, b.z);
        const nearest = ((): number => {
          let best = 0;
          let bestD = Infinity;
          for (let i = 0; i < n; i++) {
            const d = Math.min(Math.abs(cum[i] - proj), Math.abs(cum[i] - proj + lap), Math.abs(cum[i] - proj - lap));
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
          return best;
        })();
        const off = Math.min(Math.abs(nearest - b.index), n - Math.abs(nearest - b.index));
        expect(off, `${id}: index ${b.index} vs arc-nearest ${nearest}`).toBeLessThanOrEqual(3);
        expect(cum[b.index], `${id}: sorted by index arc`).toBeGreaterThanOrEqual(prev);
        prev = cum[b.index];
      }
    }
    expect(seen, 'at least one built bollard').toBeGreaterThan(0);
  }, 120000);
});

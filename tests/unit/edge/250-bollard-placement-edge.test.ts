import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, Sausage, Side } from '../../../src/core/types';
import { detectCorners, radii, type CornerRun } from '../../../tools/track-builder/corners';

const BOLLARDS_MODULE = '../../../tools/track-builder/bollards';

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

async function loadBuildBollards(): Promise<BuildBollardsFn> {
  const mod = (await import(BOLLARDS_MODULE)) as unknown as { buildBollards: BuildBollardsFn };
  return mod.buildBollards;
}

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

// Regular k-gon, corner radius R, edge `side`, walked straight-then-arc with a
// clockwise (heading decreasing) turn at every corner; theta = 360/k exactly.
function polyPoints(k: number, R: number, side: number): Point2[] {
  const t = R * Math.tan(Math.PI / k);
  const L = side - 2 * t;
  const alpha = (-2 * Math.PI) / k;
  const m = Math.max(6, Math.ceil(Math.abs(alpha) * R));
  const pts: Point2[] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  for (let j = 0; j < k; j++) {
    for (let d = 0; d < L - 1e-9; d += 2) {
      if (d > 0) {
        x += 2 * Math.cos(phi);
        z += 2 * Math.sin(phi);
      }
      pts.push([x, z]);
    }
    const rem = L - Math.floor((L - 1e-9) / 2) * 2;
    x += rem * Math.cos(phi);
    z += rem * Math.sin(phi);
    const cx = x + R * Math.sin(phi);
    const cz = z - R * Math.cos(phi);
    const a0 = Math.atan2(z - cz, x - cx);
    for (let i = 0; i < m; i++) {
      const a = a0 + (alpha * i) / m;
      pts.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]);
    }
    x = cx + R * Math.cos(a0 + alpha);
    z = cz + R * Math.sin(a0 + alpha);
    phi += alpha;
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

const BOX20_CENTRES: Point2[] = [[200, -20], [200, -220], [0, -220], [0, -20]];

function apexIndex(rs: number[], run: CornerRun, n: number): number {
  const span = wrap(run.end - run.start, n);
  let best = run.start;
  let bestR = Infinity;
  for (let k = 0; k <= span; k++) {
    const i = wrap(run.start + k, n);
    if (rs[i] < bestR) {
      bestR = rs[i];
      best = i;
    }
  }
  return best;
}

// Turn angle of a run per the design: absolute sum of signed heading changes.
function thetaDeg(points: Point2[], run: CornerRun): number {
  const n = points.length;
  const span = wrap(run.end - run.start, n);
  let sum = 0;
  for (let k = 0; k < span; k++) {
    const i = wrap(run.start + k, n);
    const j = (i + 1) % n;
    const h1 = Math.atan2(points[j][1] - points[i][1], points[j][0] - points[i][0]);
    const h2 = Math.atan2(points[(j + 1) % n][1] - points[j][1], points[(j + 1) % n][0] - points[j][0]);
    sum += Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
  }
  return Math.abs((sum * 180) / Math.PI);
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

function arcDist(a: number, b: number, lap: number): number {
  const d = Math.abs(a - b) % lap;
  return Math.min(d, lap - d);
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

describe('250 bollard placement edge', () => {
  it('EDGE1: fewer than 3 centerline points yields no bollards even with inputs', async () => {
    const buildBollards = await loadBuildBollards();
    const sausage: Sausage[] = [{ index: 0, side: 'left', offset: 7.8, length: 10 }];
    const runoff: RunoffSegment[] = [{ start: 0, end: 0, side: 'left', surface: 'runoff', widthMeters: 12 }];
    expect(buildBollards([], undefined, sausage, runoff, [])).toHaveLength(0);
    expect(buildBollards([[0, 0]], undefined, sausage, runoff, [])).toHaveLength(0);
    expect(buildBollards([[0, 0], [10, 0]], undefined, sausage, runoff, [])).toHaveLength(0);
  });

  it('EDGE2: R2 fires for theta exactly 60 and 120 degrees and not below 60', async () => {
    const buildBollards = await loadBuildBollards();
    const cases: Array<{ k: number; edge: number; theta: number; groups: number }> = [
      { k: 6, edge: 80, theta: 60, groups: 6 },
      { k: 8, edge: 70, theta: 45, groups: 0 },
      { k: 3, edge: 200, theta: 120, groups: 3 },
    ];
    for (const c of cases) {
      const pts = polyPoints(c.k, 30, c.edge);
      const runs = detectCorners(pts);
      expect(runs, `k=${c.k} corner runs`).toHaveLength(c.k);
      for (const run of runs) {
        expect(thetaDeg(pts, run), `k=${c.k} run ${run.start} theta`).toBeCloseTo(c.theta, 3);
        expect(run.minRadius, `k=${c.k} run ${run.start} minRadius`).toBeCloseTo(30, 6);
      }
      const out = buildBollards(pts, undefined, [], [], []);
      expect(out, `k=${c.k} bollards`).toHaveLength(3 * c.groups);
    }
  });

  it('EDGE3: R2 accepts minRadius exactly 40 and rejects 41', async () => {
    const buildBollards = await loadBuildBollards();
    const pts40 = boxPoints(40);
    const runs40 = detectCorners(pts40);
    expect(runs40).toHaveLength(4);
    expect(runs40.every((r) => r.minRadius <= 40)).toBe(true);
    expect(buildBollards(pts40, undefined, [], [], [])).toHaveLength(12);
    const pts41 = boxPoints(41);
    const runs41 = detectCorners(pts41);
    expect(runs41).toHaveLength(4);
    expect(runs41.every((r) => r.minRadius > 40), 'runs exist but exceed 40').toBe(true);
    expect(buildBollards(pts41, undefined, [], [], [])).toHaveLength(0);
  });
});

describe('250 bollard placement edge — run-off gating and sausage skips', () => {
  it('EDGE4: R3 needs an inner-side run-off covering the apex, accepts wrapping ranges, and is inclusive at width 10', async () => {
    const buildBollards = await loadBuildBollards();
    const pts = stadiumPoints(30);
    const n = pts.length;
    const runs = detectCorners(pts);
    expect(runs).toHaveLength(2);
    const rs = radii(pts);
    const apex1 = apexIndex(rs, runs[0], n);
    const apex2 = apexIndex(rs, runs[1], n);
    expect(apex1).toBeLessThan(apex2);
    const runoff = (start: number, end: number, side: Side, widthMeters: number): RunoffSegment[] =>
      [{ start, end, side, surface: 'runoff', widthMeters }];
    expect(
      buildBollards(pts, undefined, [], runoff(runs[0].start, runs[0].end, 'right', 12), []),
      'opposite side run-off',
    ).toHaveLength(0);
    expect(
      buildBollards(pts, undefined, [], runoff(runs[0].start, wrap(apex1 - 1, n), 'left', 12), []),
      'range not covering the apex',
    ).toHaveLength(0);
    expect(apex1 + 10).toBeLessThan(apex2);
    expect(
      buildBollards(pts, undefined, [], runoff(n - 5, apex1 + 10, 'left', 12), []),
      'wrapping range covering the apex only',
    ).toHaveLength(3);
    expect(
      buildBollards(pts, undefined, [], runoff(runs[0].start, runs[0].end, 'left', 10), []),
      'width exactly 10',
    ).toHaveLength(3);
    expect(
      buildBollards(pts, undefined, [], runoff(runs[0].start, runs[0].end, 'left', 9.9), []),
      'width below 10',
    ).toHaveLength(0);
  });

  it('EDGE5: the R2 group survives when the nearby R1 bollards are of the other side or farther than 15 m arc', async () => {
    const buildBollards = await loadBuildBollards();
    const pts = boxPoints(20);
    const runs = detectCorners(pts);
    expect(runs).toHaveLength(4);
    const apex1 = apexIndex(radii(pts), runs[0], pts.length);
    const opposite = buildBollards(
      pts, undefined, [{ index: apex1, side: 'right', offset: 7.8, length: 10 }], [], [],
    );
    expect(opposite, 'opposite-side R1 does not skip R2').toHaveLength(15);
    expect(opposite.filter((b) => b.side === 'right'), 'R1 group of 3 right').toHaveLength(3);
    expect(opposite.filter((b) => b.side === 'left'), 'R2 groups of 12 left').toHaveLength(12);
    expect(assignGroups(BOX20_CENTRES, opposite)[0], 'corner 1 carries both groups').toHaveLength(6);
    const far = buildBollards(
      pts, undefined, [{ index: apex1, side: 'left', offset: 7.8, length: 40 }], [], [],
    );
    expect(far, 'same-side R1 beyond 15 m arc does not skip R2').toHaveLength(15);
    expect(far.every((b) => b.side === 'left'), 'all left').toBe(true);
    expect(assignGroups(BOX20_CENTRES, far)[0], 'corner 1 carries both groups').toHaveLength(6);
    const { cum, lap } = cumArcs(pts);
    const apexArc = cum[apex1];
    const dists = assignGroups(BOX20_CENTRES, far)[0].map(
      (b) => arcDist(projectArc(pts, b.x, b.z), apexArc, lap),
    );
    expect(dists.filter((d) => d > 15), 'R1 bollards beyond 15 m arc of the apex').toHaveLength(3);
    expect(dists.filter((d) => d <= 5), 'R2 bollards within 5 m arc of the apex').toHaveLength(3);
  });

  it('EDGE6: an R1 group is dropped when clearance falls below halfNear + KERB_WIDTH + 0.5 and kept above it', async () => {
    const buildBollards = await loadBuildBollards();
    const pts = stadiumPoints(30);
    expect(
      buildBollards(pts, undefined, [{ index: 10, side: 'left', offset: 7.0, length: 10 }], [], []),
      'lateral 7 clears only 7.07 to the nearest sample',
    ).toHaveLength(0);
    expect(
      buildBollards(pts, undefined, [{ index: 10, side: 'left', offset: 9.0, length: 10 }], [], []),
      'lateral 9 clears 9.06',
    ).toHaveLength(3);
  });
});

describe('250 bollard placement edge — barriers and wrapping', () => {
  it('EDGE7: an R1 bollard drops only against an inner-side barrier whose offset minus 0.5 sits below the lateral', async () => {
    const buildBollards = await loadBuildBollards();
    const pts = stadiumPoints(30);
    const runs = detectCorners(pts);
    expect(runs).toHaveLength(2);
    const apex = apexIndex(radii(pts), runs[0], pts.length);
    const sausage: Sausage[] = [{ index: apex, side: 'left', offset: 9, length: 10 }];
    const barrier = (side: Side, offsetMeters: number): BarrierSegment[] => [
      { start: runs[0].start, end: runs[0].end, side, type: 'armco', offsetMeters },
    ];
    expect(
      buildBollards(pts, undefined, sausage, [], barrier('left', 8)),
      'lateral 9 > 8 - 0.5 drops all three',
    ).toHaveLength(0);
    expect(
      buildBollards(pts, undefined, sausage, [], barrier('left', 10)),
      'lateral 9 <= 10 - 0.5 keeps all three',
    ).toHaveLength(3);
    expect(
      buildBollards(pts, undefined, sausage, [], barrier('right', 8)),
      'barrier on the opposite side never drops',
    ).toHaveLength(3);
    expect(buildBollards(pts, undefined, sausage, [], []), 'no barrier').toHaveLength(3);
  });

  it('EDGE8: R1 arc positions wrap modulo the lap when the sausage end crosses the finish line', async () => {
    const buildBollards = await loadBuildBollards();
    const pts = stadiumPoints(30);
    const n = pts.length;
    const { cum, lap } = cumArcs(pts);
    expect(cum[n - 1] + 3, 'sausage end + half length past the finish line').toBeGreaterThan(lap);
    const end = (cum[n - 1] + 3) % lap;
    const sausage: Sausage[] = [{ index: n - 1, side: 'left', offset: 9, length: 10 }];
    const out = buildBollards(pts, undefined, sausage, [], []);
    expect(out).toHaveLength(3);
    const want = [end + 2, end + 4, end + 6].map((a) => a % lap);
    const arcs = out.map((b) => projectArc(pts, b.x, b.z)).sort((a, b) => a - b);
    expect(arcs).toHaveLength(3);
    arcs.forEach((arc, i) => {
      expect(Math.abs(arc - want[i]), `bollard arc ${arc} vs wrapped ${want[i]}`).toBeLessThanOrEqual(0.5);
    });
  });
});

describe('250 bollard placement edge — explicit half-widths and output order', () => {
  it('EDGE9: explicit halfWidths replace the 6 m default in the R2 lateral and in halfNear', async () => {
    const buildBollards = await loadBuildBollards();
    const box = boxPoints(20);
    const asymmetric = buildBollards(
      box,
      { left: box.map(() => 7), right: box.map(() => 3) },
      [], [], [],
    );
    expect(asymmetric).toHaveLength(12);
    const groups = assignGroups(BOX20_CENTRES, asymmetric);
    groups.forEach((group, j) => {
      expect(group, `corner ${j} has 3 bollards`).toHaveLength(3);
      const middle = byArc(box, group)[1];
      const d = Math.hypot(middle.x - BOX20_CENTRES[j][0], middle.z - BOX20_CENTRES[j][1]);
      expect(
        Math.abs(d - (20 - (7 + 1.2 + 1.0))),
        `corner ${j} middle distance ${d} (inner-side half 7, not right 3, min or default 6)`,
      ).toBeLessThanOrEqual(0.3);
    });
    const pts = stadiumPoints(30);
    const sausage: Sausage[] = [{ index: 10, side: 'left', offset: 5, length: 10 }];
    expect(
      buildBollards(pts, { left: pts.map(() => 6), right: pts.map(() => 6) }, sausage, [], []),
      'halfNear 6: clearance 5.1 < 7.7 drops',
    ).toHaveLength(0);
    expect(
      buildBollards(pts, { left: pts.map(() => 3), right: pts.map(() => 6) }, sausage, [], []),
      'halfNear 3: clearance 5.1 >= 4.7 keeps',
    ).toHaveLength(3);
    expect(
      buildBollards(pts, { left: pts.map(() => 6), right: pts.map(() => 3) }, sausage, [], []),
      'halfNear is the min of both sides',
    ).toHaveLength(3);
  });

  it('EDGE10: output is sorted by arc position of the bollard index with a corner-3 sausage group in arc order', async () => {
    const buildBollards = await loadBuildBollards();
    const points = boxPoints(20);
    const runs = detectCorners(points);
    expect(runs).toHaveLength(4);
    const apex = apexIndex(radii(points), runs[2], points.length);
    const out = buildBollards(
      points, undefined, [{ index: apex, side: 'left', offset: 7.8, length: 10 }], [], [],
    );
    expect(out).toHaveLength(12);
    const { cum } = cumArcs(points);
    const arcs = out.map((b) => cum[b.index]);
    for (let i = 1; i < arcs.length; i++) {
      expect(arcs[i], `arc of index at position ${i} >= ${arcs[i - 1]}`).toBeGreaterThanOrEqual(arcs[i - 1]);
    }
    const cornerOf = out.map((b) => {
      let best = 0;
      let bestD = Infinity;
      BOX20_CENTRES.forEach((c, j) => {
        const d = Math.hypot(b.x - c[0], b.z - c[1]);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      return best;
    });
    expect(cornerOf, 'groups in corner order: R2 at 1-2, R1 at 3, R2 at 4').toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
  });
});

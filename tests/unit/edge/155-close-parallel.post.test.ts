import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type {
  BarrierSegment,
  RunoffSegment,
  TrackDataV2,
  TrackSegment,
} from '../../../src/core/types';
import { buildTrackSurfaces, halfWidthAt } from '../../../src/track/surfaces';
import {
  analyzeParallel,
  applyMedianWalls,
  stripParallel,
  type ParallelInfo,
} from '../../../tools/track-builder/parallel';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const WIDTH = 12;
const HALF = WIDTH / 2;

type Track155 = TrackDataV2 & { halfWidthLeft?: number[]; halfWidthRight?: number[] };

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const covers = (seg: { start: number; end: number }, i: number, n: number): boolean =>
  wrap(i - wrap(seg.start, n), n) <= wrap(wrap(seg.end, n) - wrap(seg.start, n), n);

function hairpinLoop(sep: number): Point2[] {
  const r = sep / 2;
  const pts: Point2[] = [];
  for (let z = 0; z <= 300; z += 2) pts.push([0, z]);
  for (let k = 1; k <= 8; k++) {
    const t = Math.PI * (1 - k / 8);
    pts.push([r + r * Math.cos(t), 300 + r * Math.sin(t)]);
  }
  for (let z = 298; z >= 0; z -= 2) pts.push([sep, z]);
  for (let k = 1; k <= 7; k++) {
    const t = -(Math.PI * k) / 8;
    pts.push([r + r * Math.cos(t), r * Math.sin(t)]);
  }
  return pts;
}

// Two mirrored parallel lines (x = 0 and x = 10) joined by a straight connector.
function fold(m: number): Point2[] {
  const pts: Point2[] = [];
  for (let k = 0; k < m; k++) pts.push([0, k * 2]);
  for (let k = 0; k < m; k++) pts.push([10, (m - 1 - k) * 2]);
  return pts;
}

function rightNormal(cx: Point2[], i: number): [number, number] {
  const n = cx.length;
  const p = cx[(i - 1 + n) % n];
  const q = cx[(i + 1) % n];
  let dx = q[0] - p[0];
  let dz = q[1] - p[1];
  const len = Math.hypot(dx, dz);
  dx /= len;
  dz /= len;
  return [-dz, dx];
}

function lateralAt(
  strip: { positions: Float32Array },
  cx: Point2[],
  ci: number,
  row: number,
  col: number,
  cols: number,
): number {
  const p = (row * cols + col) * 3;
  const [rx, rz] = rightNormal(cx, ci);
  return (strip.positions[p] - cx[ci][0]) * rx + (strip.positions[p + 2] - cx[ci][1]) * rz;
}

function loopTrack(pts: Point2[], over: Partial<Track155>): Track155 {
  return {
    ...fixture,
    id: 'hairpin-loop',
    name: 'Hairpin Loop',
    widthMeters: WIDTH,
    lengthMeters: 631,
    officialLengthMeters: 631,
    centerline: pts,
    sectors: [0, 100, 200],
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    trees: [],
    treeSpecies: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    ...over,
  };
}

function craftedInfo(n: number, masked: (i: number) => boolean): ParallelInfo {
  return {
    halfLeft: Array.from({ length: n }, (_, i) => (masked(i) ? 4.5 : HALF)),
    halfRight: new Array<number>(n).fill(HALF),
    medianLeft: Array.from({ length: n }, (_, i) => (masked(i) ? 5 : null)),
    medianRight: new Array<number | null>(n).fill(null),
    sepLeft: new Array<number>(n).fill(50),
    sepRight: new Array<number>(n).fill(50),
    widthMeters: WIDTH,
    any: true,
  };
}

describe('155 close parallel sections post-coder gaps', () => {
  it('P1: asphalt columns follow the per-side half-widths on narrowed indices', () => {
    const pts = hairpinLoop(10);
    const halfLeft = pts.map((_, i) => (i >= 50 && i <= 100 ? 4.5 : HALF));
    const halfRight = pts.map((_, i) => (i >= 210 && i <= 250 ? 4.5 : HALF));
    const track = loopTrack(pts, { halfWidthLeft: halfLeft, halfWidthRight: halfRight });
    const strips = buildTrackSurfaces(track);
    expect(strips[0]?.surface, 'asphalt strip').toBe('asphalt');
    const asphalt = strips[0];
    expect(lateralAt(asphalt, pts, 75, 75, 0, 2), 'left column narrowed').toBeCloseTo(-4.5, 3);
    expect(lateralAt(asphalt, pts, 75, 75, 1, 2), 'right column default').toBeCloseTo(6, 3);
    expect(lateralAt(asphalt, pts, 30, 30, 0, 2), 'left column un-narrowed').toBeCloseTo(-6, 3);
    expect(lateralAt(asphalt, pts, 233, 233, 1, 2), 'right straight narrowed').toBeCloseTo(4.5, 3);
    expect(lateralAt(asphalt, pts, 233, 233, 0, 2), 'right straight left column').toBeCloseTo(-6, 3);
  });

  it('P2: a ring whose every index pair is within 60 indices never masks; one index beyond does', () => {
    const allAdjacent = analyzeParallel(fold(60), WIDTH);
    expect(allAdjacent.any, 'n=120: all pairs adjacent, nothing masked').toBe(false);
    expect(allAdjacent.halfLeft.every((v) => v === HALF), 'n=120 halfLeft default').toBe(true);
    expect(allAdjacent.medianLeft.every((v) => v === null), 'n=120 medianLeft null').toBe(true);

    const beyond = analyzeParallel(fold(62), WIDTH);
    expect(beyond.any, 'n=124: fold middle is non-adjacent and masked').toBe(true);
    expect(beyond.medianLeft[31], 'fold middle median').toBeCloseTo(5, 6);
    expect(beyond.halfLeft[31], 'fold middle half').toBeCloseTo(4.5, 6);
    expect(beyond.medianRight[31], 'fold middle right median stays null').toBe(null);
  });

  it('P3: near-zero separations clamp the half-width at 2 while the median keeps flooring', () => {
    const pts = hairpinLoop(1);
    const info = analyzeParallel(pts, WIDTH);
    expect(info.any, 'premise: 1 m separation is masked').toBe(true);
    for (let i = 50; i <= 100; i++) {
      expect(pts[i][0], `premise: index ${i} on the left straight`).toBe(0);
      expect(info.medianLeft[i], `median at ${i}`).toBeCloseTo(0.5, 6);
      expect(info.halfLeft[i], `half clamped at MIN_HALF, index ${i}`).toBe(2);
    }
  });

  it('P4: a duplicated point (degenerate tangent) does not break the analysis', () => {
    const clean = analyzeParallel(hairpinLoop(10), WIDTH);
    const pts = hairpinLoop(10);
    const dup: Point2 = [pts[75][0], pts[75][1]];
    pts.splice(75, 0, dup);
    const info = analyzeParallel(pts, WIDTH);
    expect(info.any, 'premise: still masks').toBe(true);
    expect(info.halfLeft).toHaveLength(pts.length);
    for (let i = 0; i < pts.length; i++) {
      expect(Number.isFinite(info.halfLeft[i]), `halfLeft finite at ${i}`).toBe(true);
      expect(info.halfLeft[i] >= 2 && info.halfLeft[i] <= HALF, `halfLeft in range at ${i}`).toBe(true);
      const m = info.medianLeft[i];
      expect(m === null || Number.isFinite(m), `medianLeft null or finite at ${i}`).toBe(true);
    }
    expect(clean.medianLeft[30], 'premise: clean index 30 masked').not.toBe(null);
    expect(info.medianLeft[30], 'median away from the duplicate matches').toBe(clean.medianLeft[30]);
    expect(info.halfLeft[30], 'half away from the duplicate matches').toBe(clean.halfLeft[30]);
  });

  it('P5: stripParallel is a no-op when info.any is false', () => {
    const wide = analyzeParallel(fold(60), WIDTH);
    expect(wide.any, 'premise: not masked').toBe(false);
    const n = 120;
    const segs: TrackSegment[] = [
      { start: 0, end: n - 1, side: 'left' },
      { start: 10, end: 50, side: 'right' },
    ];
    expect(stripParallel(segs, wide)).toEqual(segs);
  });

  it('P6: run-off runs trim one index next to a masked neighbour; a lone unmasked index keeps the kerb but loses the run-off', () => {
    const n = 20;
    const runoff: RunoffSegment = { start: 0, end: n - 1, side: 'left', surface: 'gravel', widthMeters: 3 };
    const kerb: TrackSegment = { start: 0, end: n - 1, side: 'left' };

    const solo = craftedInfo(n, (i) => i !== 10);
    expect(stripParallel([runoff], solo), 'sandwiched run-off dropped by both trims').toEqual([]);
    expect(stripParallel([kerb], solo), 'kerb keeps the single unmasked index').toEqual([
      { start: 10, end: 10, side: 'left' },
    ]);

    const band = craftedInfo(n, (i) => i >= 5 && i <= 14);
    const out = stripParallel([runoff], band);
    expect(out, 'wrap-merged run trimmed at both ends').toEqual([{ ...runoff, start: 16, end: 3 }]);
    for (let i = 0; i < n; i++) {
      const expected = i >= 16 || i <= 3;
      expect(out.some((s) => covers(s, i, n)), `run-off coverage at ${i}`).toBe(expected);
    }
  });

  it('P7: run-offs also clear where their width would reach the other section (sep below width + w + kerb)', () => {
    const n = 20;
    const narrow: RunoffSegment = { start: 0, end: n - 1, side: 'left', surface: 'gravel', widthMeters: 1 };
    const wide: RunoffSegment = { start: 0, end: n - 1, side: 'left', surface: 'gravel', widthMeters: 4 };
    // any=true via a right-side mask only, so left removals isolate the reach rule.
    const info = craftedInfo(n, () => false);
    info.any = true;
    info.medianRight[0] = 5;
    info.halfRight[0] = 4.5;
    info.sepLeft = new Array<number>(n).fill(17); // reach: 14.2 for w=1, 17.2 for w=4
    expect(stripParallel([narrow], info), 'narrow run-off stays clear of nothing').toEqual([narrow]);
    expect(stripParallel([wide], info), 'wide run-off stripped everywhere by the reach rule').toEqual([]);
  });

  it('P8: applyMedianWalls creates no wall where no barrier covered the index and early-returns on empty input or any=false', () => {
    const n = 20;
    const info = craftedInfo(n, (i) => i === 5 || i === 15);
    const barriers: BarrierSegment[] = [
      { start: 0, end: 9, side: 'left', type: 'armco', offsetMeters: HALF },
      { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF },
    ];
    const out = applyMedianWalls(barriers, info, n);
    expect(out.filter((b) => b.side === 'left' && covers(b, 15, n)), 'gap stays a gap').toHaveLength(0);
    expect(out.filter((b) => b.side === 'left' && covers(b, 5, n)), 'masked covered index becomes a wall').toEqual([
      { start: 5, end: 5, side: 'left', type: 'wall', offsetMeters: 5 },
    ]);
    const left0 = out.filter((b) => b.side === 'left' && covers(b, 0, n));
    expect(left0[0]?.type, 'unmasked covered index keeps its barrier').toBe('armco');

    expect(applyMedianWalls([], info, n), 'empty barriers').toEqual([]);
    expect(applyMedianWalls(barriers, { ...info, any: false }, n), 'any=false returns input').toEqual(barriers);
  });

  it('P9: a narrowed index without a covering barrier keeps the normal verge flat and outer extent', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const halfLeft = pts.map((_, i) => (i >= 50 && i <= 100 ? 4.5 : HALF));
    const track = loopTrack(pts, {
      halfWidthLeft: halfLeft,
      barriers: [{ start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF }],
    });
    const verges = buildTrackSurfaces(track).filter((s) => s.positions.length === n * 9);
    expect(verges, 'two verge strips').toHaveLength(2);
    const left = verges[0];
    for (const i of [50, 75, 100]) {
      expect(lateralAt(left, pts, i, i, 2, 3), `inner at ${i}`).toBeCloseTo(-4.5, 3);
      expect(lateralAt(left, pts, i, i, 1, 3), `uncapped flat at ${i}`).toBeCloseTo(-10.5, 3);
      expect(lateralAt(left, pts, i, i, 0, 3), `uncapped outer at ${i}`).toBeCloseTo(-13.5, 3);
    }
  });

  it('P10: halfWidthAt falls back past the array ends and for negative indices', () => {
    const partial: Track155 = { ...fixture, halfWidthLeft: [1, 2, 3, 4] };
    expect(halfWidthAt(partial, 'left', 2), 'premise: in-range value').toBe(3);
    expect(halfWidthAt(partial, 'left', 99), 'past the end').toBe(6);
    expect(halfWidthAt(partial, 'left', -1), 'negative index').toBe(6);
  });
});

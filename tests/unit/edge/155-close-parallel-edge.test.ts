import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type {
  BarrierSegment,
  RunoffSegment,
  Side,
  SurfaceStrip,
  TrackDataV2,
  TrackSegment,
} from '../../../src/core/types';
import { KERB_WIDTH } from '../../../src/core/constants';
import * as surfaces from '../../../src/track/surfaces';
import { buildTrackMarkings } from '../../../src/track/markings';
import { analyzeParallel, applyMedianWalls, stripParallel } from '../../../tools/track-builder/parallel';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

// Task 155 adds halfWidthAt to surfaces.ts; the cast keeps this test-first
// file type-checking until the export exists.
const halfWidthAt = (
  surfaces as unknown as {
    halfWidthAt: (track: TrackDataV2, side: Side, i: number) => number;
  }
).halfWidthAt;

type Track155 = TrackDataV2 & { halfWidthLeft?: number[]; halfWidthRight?: number[] };

const WIDTH = 12;
const HALF = WIDTH / 2;

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const covers = (seg: { start: number; end: number }, i: number, n: number): boolean =>
  wrap(i - wrap(seg.start, n), n) <= wrap(wrap(seg.end, n) - wrap(seg.start, n), n);

// Two straights `sep` m apart (x = 0 and x = sep) joined by half-turn hairpins,
// ~2 m point spacing, closed, 316 points.
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

// Loop with two flanking straights (x = 10 and x = -10) both exactly 10 m
// from the center point (0, 200) = index 100 of the x = 0 lead straight:
// an exact distance tie resolved by the lowest j (on the left-straight side).
function tieLoop(): Point2[] {
  const pts: Point2[] = [];
  for (let z = 0; z <= 400; z += 2) pts.push([0, z]);
  for (let k = 1; k <= 8; k++) {
    const t = Math.PI * (1 - k / 8);
    pts.push([5 + 5 * Math.cos(t), 400 + 5 * Math.sin(t)]);
  }
  for (let z = 398; z >= -100; z -= 2) pts.push([10, z]);
  for (let k = 1; k <= 16; k++) {
    const t = (-Math.PI * k) / 16;
    pts.push([10 * Math.cos(t), -100 + 10 * Math.sin(t)]);
  }
  for (let z = -98; z <= 350; z += 2) pts.push([-10, z]);
  for (let x = -20; x >= -60; x -= 10) pts.push([x, 350]);
  for (let z = 348; z >= 0; z -= 2) pts.push([-60, z]);
  for (let x = -50; x <= -10; x += 10) pts.push([x, 0]);
  return pts;
}

// Indices of the left straight's parallel middle: z in [100, 200], far from
// both hairpins and from the 60-index adjacency window.
function midA(pts: Point2[]): number[] {
  const out: number[] = [];
  pts.forEach((p, i) => {
    if (p[0] === 0 && p[1] >= 100 && p[1] <= 200) out.push(i);
  });
  return out;
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

/** Signed lateral offset of strip column `col` of row `row` (of `cols` columns) at centerline index `ci`. */
function lateralAt(
  strip: SurfaceStrip,
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

describe('155 close parallel sections edge cases', () => {
  it('EDGE1: analyzeParallel returns all-default info for fewer than 3 points', () => {
    const cases: Point2[][] = [[], [[0, 0]], [[0, 0], [0, 10]]];
    for (const pts of cases) {
      const info = analyzeParallel(pts, WIDTH);
      expect(info.any, `n=${pts.length} any`).toBe(false);
      expect(info.halfLeft, `n=${pts.length} halfLeft length`).toHaveLength(pts.length);
      expect(info.halfRight, `n=${pts.length} halfRight length`).toHaveLength(pts.length);
      expect(info.halfLeft.every((v: number) => v === HALF), `n=${pts.length} halfLeft values`).toBe(true);
      expect(info.halfRight.every((v: number) => v === HALF), `n=${pts.length} halfRight values`).toBe(true);
      expect(info.medianLeft.every((v: number | null) => v === null), `n=${pts.length} medianLeft`).toBe(true);
      expect(info.medianRight.every((v: number | null) => v === null), `n=${pts.length} medianRight`).toBe(true);
    }
  });

  it('EDGE2: masking boundaries — strict width + 6 threshold, 60-index adjacency exclusion, lowest-j tie-break, input not mutated', () => {
    const widePts = hairpinLoop(18);
    const snapshot = JSON.parse(JSON.stringify(widePts)) as Point2[];
    const wide = analyzeParallel(widePts, WIDTH);
    expect(widePts).toEqual(snapshot);
    expect(wide.any, 'separation exactly width + 6 is not masked').toBe(false);
    expect(wide.medianLeft.every((v: number | null) => v === null), 'wide medianLeft null').toBe(true);
    expect(wide.medianRight.every((v: number | null) => v === null), 'wide medianRight null').toBe(true);
    expect(wide.halfLeft.every((v: number) => v === HALF), 'wide halfLeft default').toBe(true);
    expect(wide.halfRight.every((v: number) => v === HALF), 'wide halfRight default').toBe(true);

    const close = analyzeParallel(hairpinLoop(17.75), WIDTH);
    expect(close.any, 'separation below width + 6 is masked').toBe(true);
    expect(close.medianLeft.some((v: number | null) => v !== null), 'close mask on the facing side').toBe(true);

    // Hairpin ends sit geometrically ~5-10 m from the other road, but within
    // the 60-index adjacency window: they must stay unmasked.
    const adj = analyzeParallel(hairpinLoop(10), WIDTH);
    expect(adj.any, 'premise: the 10 m loop is masked on the straights').toBe(true);
    for (const i of [150, 154]) {
      expect(adj.medianLeft[i], `adjacency: left median at hairpin index ${i}`).toBe(null);
      expect(adj.medianRight[i], `adjacency: right median at hairpin index ${i}`).toBe(null);
      expect(adj.halfLeft[i], `adjacency: left half at hairpin index ${i}`).toBe(HALF);
      expect(adj.halfRight[i], `adjacency: right half at hairpin index ${i}`).toBe(HALF);
    }

    // Index 100 is equidistant (d = 10) from both flanking straights; the
    // lowest j lies on the +x side, so only the left side is masked.
    const tie = analyzeParallel(tieLoop(), WIDTH);
    expect(tie.any, 'premise: tie geometry is masked').toBe(true);
    expect(tie.medianLeft[100], 'tie: left median from lowest j').toBeCloseTo(5, 6);
    expect(tie.halfLeft[100], 'tie: left half from median 5').toBeCloseTo(4.5, 6);
    expect(tie.medianRight[100], 'tie: right median stays null').toBe(null);
    expect(tie.halfRight[100], 'tie: right half stays default').toBe(HALF);
  });

  it('EDGE3: median floors d/2 to 0.25 m and half-width clamps into [2, widthMeters/2] at separations 4.5, 9.9 and 17.75', () => {
    for (const sep of [4.5, 9.9, 17.75]) {
      const pts = hairpinLoop(sep);
      const info = analyzeParallel(pts, WIDTH);
      expect(info.any, `sep ${sep} masked`).toBe(true);
      const med = Math.floor((sep / 2) * 4) / 4;
      const half = Math.max(2, Math.min(HALF, med - 0.5));
      for (const i of midA(pts)) {
        expect(info.medianLeft[i], `sep ${sep} index ${i} median`).toBeCloseTo(med, 6);
        expect(info.halfLeft[i], `sep ${sep} index ${i} half`).toBeCloseTo(half, 6);
      }
    }
  });

  it('EDGE4: only the side facing the other section is affected — the right side keeps half width, null medians, kerbs, run-offs and its barrier', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    expect(info.medianLeft.some((v: number | null) => v !== null), 'premise: left masks exist').toBe(true);
    expect(info.medianRight.every((v: number | null) => v === null), 'right medians stay null').toBe(true);
    expect(info.halfRight.every((v: number) => v === HALF), 'right half stays widthMeters/2').toBe(true);

    const kerbs = stripParallel([{ start: 0, end: n - 1, side: 'right' }], info);
    const barriers = applyMedianWalls(
      [
        { start: 0, end: n - 1, side: 'left', type: 'armco', offsetMeters: HALF },
        { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF },
      ],
      info,
      n,
    );
    for (let i = 0; i < n; i++) {
      expect(kerbs.some((k: TrackSegment) => covers(k, i, n)), `right kerb at ${i}`).toBe(true);
      const right = barriers.filter((b: BarrierSegment) => b.side === 'right' && covers(b, i, n));
      expect(right, `right barrier at ${i}`).toHaveLength(1);
      expect(right[0].type, `right barrier type at ${i}`).toBe('armco');
      expect(right[0].offsetMeters, `right barrier offset at ${i}`).toBe(HALF);
    }
  });

  it('EDGE5: stripParallel removes exactly the masked indices per side, wrap-aware, without mutating its inputs', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    const maskL = info.medianLeft.map((v: number | null) => v !== null);
    const maskR = info.medianRight.map((v: number | null) => v !== null);
    expect(maskL.some(Boolean), 'premise: left masks exist').toBe(true);
    expect(maskR.some(Boolean), 'premise: no right masks').toBe(false);
    const infoSnapshot = JSON.parse(JSON.stringify(info)) as typeof info;

    const kerbFull: TrackSegment = { start: 0, end: n - 1, side: 'left' };
    const kerbWrapped: TrackSegment = { start: 200, end: 100, side: 'left' };
    const runoffRight: RunoffSegment = {
      start: 0,
      end: n - 1,
      side: 'right',
      surface: 'gravel',
      widthMeters: 18,
    };
    expect(
      pts.some((_, i) => covers(kerbWrapped, i, n) && maskL[i]),
      'premise: wrapped kerb covers masked indices',
    ).toBe(true);
    const inputs = [kerbFull, kerbWrapped, runoffRight];
    const snapshot = JSON.parse(JSON.stringify(inputs)) as typeof inputs;

    for (const input of inputs) {
      const out = stripParallel([input], info);
      const mask = input.side === 'left' ? maskL : maskR;
      expect(out.every((s: TrackSegment | RunoffSegment) => s.side === input.side), `side preserved for ${input.side} ${input.start}-${input.end}`).toBe(true);
      for (const s of out) {
        if ('surface' in input) {
          const rin = input as RunoffSegment;
          const rs = s as RunoffSegment;
          expect(rs.surface, `run-off surface preserved for ${input.start}-${input.end}`).toBe(rin.surface);
          expect(rs.widthMeters, `run-off width preserved for ${input.start}-${input.end}`).toBe(rin.widthMeters);
        }
      }
      for (let i = 0; i < n; i++) {
        const expected = covers(input, i, n) && !mask[i] ? 1 : 0;
        const count = out.filter((s: TrackSegment | RunoffSegment) => covers(s, i, n)).length;
        expect(count, `${input.side} ${input.start}-${input.end} coverage at ${i}`).toBe(expected);
      }
    }
    expect(inputs).toEqual(snapshot);
    expect(info).toEqual(infoSnapshot);
  });

  it('EDGE6: applyMedianWalls overrides foam and tyres with the median wall on masked indices and leaves unmasked barriers unchanged', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    const maskL = info.medianLeft.map((v: number | null) => v !== null);
    expect(maskL.some(Boolean), 'premise: masked left indices').toBe(true);
    expect(info.medianRight.some((v: number | null) => v !== null), 'premise: no right masks').toBe(false);
    const barriers: BarrierSegment[] = [
      { start: 0, end: n - 1, side: 'left', type: 'foam', offsetMeters: HALF },
      { start: 0, end: n - 1, side: 'right', type: 'tyres', offsetMeters: HALF },
    ];
    const out = applyMedianWalls(barriers, info, n);
    for (let i = 0; i < n; i++) {
      const left = out.filter((b: BarrierSegment) => b.side === 'left' && covers(b, i, n));
      expect(left, `left barrier at ${i}`).toHaveLength(1);
      if (maskL[i]) {
        expect(left[0].type, `left type at ${i}`).toBe('wall');
        expect(left[0].offsetMeters, `left wall offset at ${i}`).toBeCloseTo(info.medianLeft[i] ?? 0, 6);
      } else {
        expect(left[0].type, `left type at ${i}`).toBe('foam');
        expect(left[0].offsetMeters, `left foam offset at ${i}`).toBe(HALF);
      }
      const right = out.filter((b: BarrierSegment) => b.side === 'right' && covers(b, i, n));
      expect(right, `right barrier at ${i}`).toHaveLength(1);
      expect(right[0].type, `right type at ${i}`).toBe('tyres');
      expect(right[0].offsetMeters, `right tyres offset at ${i}`).toBe(HALF);
    }
  });

  it('EDGE7: applyMedianWalls re-merges equal neighbours, keeps one partition per side, is sorted by side then start, and does not mutate its input', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const info = analyzeParallel(pts, WIDTH);
    const maskL = info.medianLeft.map((v: number | null) => v !== null);
    expect(maskL.some(Boolean), 'premise: some masked left indices').toBe(true);
    expect(maskL.every(Boolean), 'premise: not every index masked').toBe(false);
    const barriers: BarrierSegment[] = [
      { start: 201, end: n - 1, side: 'left', type: 'armco', offsetMeters: HALF },
      { start: 0, end: 100, side: 'left', type: 'armco', offsetMeters: HALF },
      { start: 101, end: 200, side: 'left', type: 'armco', offsetMeters: HALF },
      { start: 158, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF },
      { start: 0, end: 157, side: 'right', type: 'armco', offsetMeters: HALF },
    ];
    const snapshot = JSON.parse(JSON.stringify(barriers)) as BarrierSegment[];
    const out = applyMedianWalls(barriers, info, n);
    expect(barriers).toEqual(snapshot);

    for (let i = 0; i < n; i++) {
      const left = out.filter((b: BarrierSegment) => b.side === 'left' && covers(b, i, n));
      expect(left, `left partition at ${i}`).toHaveLength(1);
      expect(left[0].type === 'wall', `left wall iff masked at ${i}`).toBe(maskL[i]);
      const right = out.filter((b: BarrierSegment) => b.side === 'right' && covers(b, i, n));
      expect(right, `right partition at ${i}`).toHaveLength(1);
    }

    // Medians vary at the run tails (diagonal closest points), so walls need
    // not be one segment per run; equal neighbours must still be merged.
    for (const side of ['left', 'right'] as Side[]) {
      const segs = out.filter((b: BarrierSegment) => b.side === side);
      for (let k = 0; k < segs.length; k++) {
        const a = segs[k];
        const b = segs[(k + 1) % segs.length];
        if (segs.length < 2) break;
        const adjacent = wrap(wrap(a.end, n) + 1 - wrap(b.start, n), n) === 0;
        if (adjacent) {
          expect(
            a.type !== b.type || a.offsetMeters !== b.offsetMeters,
            `neighbours ${a.start}-${a.end} and ${b.start}-${b.end} on ${side} share type/offset and were not re-merged`,
          ).toBe(true);
        }
      }
    }

    const rightOut = out.filter((b: BarrierSegment) => b.side === 'right');
    expect(rightOut, 'equal right neighbours re-merge into one segment').toHaveLength(1);
    expect(rightOut[0].type, 'merged right type').toBe('armco');
    expect(rightOut[0].offsetMeters, 'merged right offset').toBe(HALF);

    for (const side of ['left', 'right'] as Side[]) {
      const starts = out.filter((b: BarrierSegment) => b.side === side).map((b: BarrierSegment) => b.start);
      for (let k = 1; k < starts.length; k++) {
        expect(starts[k], `starts ascending on ${side}`).toBeGreaterThanOrEqual(starts[k - 1]);
      }
    }
    let sideSwitches = 0;
    for (let k = 1; k < out.length; k++) {
      if (out[k].side !== out[k - 1].side) sideSwitches++;
    }
    expect(sideSwitches, 'each side forms one contiguous block').toBeLessThanOrEqual(1);
  });

  it('EDGE8: halfWidthAt falls back to widthMeters/2 for any side whose array is absent', () => {
    expect(halfWidthAt(fixture, 'left', 0), 'left fallback').toBe(6);
    expect(halfWidthAt(fixture, 'right', 3), 'right fallback').toBe(6);
    const narrow: Track155 = { ...fixture, widthMeters: 8 };
    expect(halfWidthAt(narrow, 'left', 1), 'fallback is widthMeters/2').toBe(4);
    const partial: Track155 = { ...fixture, halfWidthLeft: [1, 2, 3, 4] };
    expect(halfWidthAt(partial, 'left', 2), 'array value wins when present').toBe(3);
    expect(halfWidthAt(partial, 'left', 0), 'array value at index 0').toBe(1);
    expect(halfWidthAt(partial, 'right', 2), 'other side still falls back').toBe(6);
  });

  it('EDGE9: verge flat and outer cap at the covering barrier offset on narrowed indices, never below inner, and stay unchanged elsewhere', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const halfLeft = pts.map((_, i) => (i >= 50 && i <= 100 ? 4.5 : HALF));
    const wall: BarrierSegment = { start: 40, end: 110, side: 'left', type: 'wall', offsetMeters: 5 };
    const rightArmco: BarrierSegment = { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: HALF };
    const vergeOf = (track: Track155, sideIndex: number): SurfaceStrip => {
      const verges = surfaces.buildTrackSurfaces(track).filter((s) => s.positions.length === n * 9);
      expect(verges, 'two verge strips').toHaveLength(2);
      return verges[sideIndex];
    };

    const bare = vergeOf(loopTrack(pts, { halfWidthLeft: halfLeft, barriers: [wall, rightArmco] }), 0);
    for (const i of [50, 75, 100]) {
      expect(lateralAt(bare, pts, i, i, 2, 3), `inner at ${i}`).toBeCloseTo(-4.5, 3);
      expect(lateralAt(bare, pts, i, i, 1, 3), `flat at ${i}`).toBeCloseTo(-5, 3);
      expect(lateralAt(bare, pts, i, i, 0, 3), `outer at ${i}`).toBeCloseTo(-5, 3);
    }
    // Barrier covers index 45 but the side is not narrowed: no cap.
    expect(lateralAt(bare, pts, 45, 45, 2, 3), 'inner at 45').toBeCloseTo(-6, 3);
    expect(lateralAt(bare, pts, 45, 45, 1, 3), 'flat at 45').toBeCloseTo(-12, 3);
    expect(lateralAt(bare, pts, 45, 45, 0, 3), 'outer at 45').toBeCloseTo(-15, 3);
    // Non-narrowed straight on the other road and the right verge are unchanged.
    expect(lateralAt(bare, pts, 200, 200, 1, 3), 'left flat at 200').toBeCloseTo(-12, 3);
    const rightVerge = vergeOf(loopTrack(pts, { halfWidthLeft: halfLeft, barriers: [wall, rightArmco] }), 1);
    expect(lateralAt(rightVerge, pts, 75, 75, 0, 3), 'right inner at 75').toBeCloseTo(6, 3);
    expect(lateralAt(rightVerge, pts, 75, 75, 1, 3), 'right flat at 75').toBeCloseTo(12, 3);

    const withRunoff = vergeOf(
      loopTrack(pts, {
        halfWidthLeft: halfLeft,
        barriers: [wall, rightArmco],
        runoffs: [{ start: 40, end: 110, side: 'left', surface: 'gravel', widthMeters: 6 }],
      }),
      0,
    );
    for (const i of [50, 75, 100]) {
      const inner = lateralAt(withRunoff, pts, i, i, 2, 3);
      expect(inner, `run-off inner at ${i}`).toBeCloseTo(-10.5, 3);
      expect(lateralAt(withRunoff, pts, i, i, 1, 3), `flat never below inner at ${i}`).toBeCloseTo(-10.5, 3);
      expect(lateralAt(withRunoff, pts, i, i, 0, 3), `outer never below inner at ${i}`).toBeCloseTo(-10.5, 3);
    }
  });

  it('EDGE10: edge lines, kerb inner edge and run-off inner edge use the per-side half-width', () => {
    const pts = hairpinLoop(10);
    const n = pts.length;
    const halfLeft = pts.map((_, i) => (i >= 50 && i <= 100 ? 4.5 : HALF));
    const track = loopTrack(pts, {
      halfWidthLeft: halfLeft,
      kerbs: [{ start: 60, end: 70, side: 'left' }],
      runoffs: [{ start: 72, end: 82, side: 'left', surface: 'gravel', widthMeters: 3 }],
    });
    const strips = surfaces.buildTrackSurfaces(track);
    expect(strips[1]?.surface, 'kerb strip').toBe('kerb');
    expect(strips[2]?.surface, 'run-off strip').toBe('gravel');
    const kerb = strips[1];
    const runoff = strips[2];
    const kerbRows = kerb.positions.length / 6;
    for (let row = 0; row < kerbRows; row++) {
      const ci = wrap(59 + row, n);
      expect(lateralAt(kerb, pts, ci, row, 1, 2), `kerb inner row ${row}`).toBeCloseTo(-4.5, 3);
      expect(lateralAt(kerb, pts, ci, row, 0, 2), `kerb outer row ${row}`).toBeCloseTo(-(4.5 + KERB_WIDTH), 3);
    }
    const runoffRows = runoff.positions.length / 6;
    for (let row = 0; row < runoffRows; row++) {
      const ci = wrap(71 + row, n);
      expect(lateralAt(runoff, pts, ci, row, 1, 2), `run-off inner row ${row}`).toBeCloseTo(-4.5, 3);
      expect(lateralAt(runoff, pts, ci, row, 0, 2), `run-off outer row ${row}`).toBeCloseTo(-7.5, 3);
    }

    const [leftEdge, rightEdge] = buildTrackMarkings(track);
    const leftBand = Math.abs(lateralAt(leftEdge, pts, 30, 30, 1, 2) - lateralAt(leftEdge, pts, 30, 30, 0, 2));
    const rightBand = Math.abs(lateralAt(rightEdge, pts, 30, 30, 1, 2) - lateralAt(rightEdge, pts, 30, 30, 0, 2));
    expect(lateralAt(leftEdge, pts, 30, 30, 0, 2), 'left edge outer at 30').toBeCloseTo(-6, 3);
    expect(lateralAt(rightEdge, pts, 30, 30, 1, 2), 'right edge outer at 30').toBeCloseTo(6, 3);
    for (const i of [50, 75, 100]) {
      expect(lateralAt(leftEdge, pts, i, i, 0, 2), `left edge outer at ${i}`).toBeCloseTo(-4.5, 3);
      expect(
        Math.abs(lateralAt(leftEdge, pts, i, i, 1, 2) - lateralAt(leftEdge, pts, i, i, 0, 2)),
        `left edge band at ${i}`,
      ).toBeCloseTo(leftBand, 6);
      expect(lateralAt(rightEdge, pts, i, i, 1, 2), `right edge outer at ${i}`).toBeCloseTo(6, 3);
      expect(
        Math.abs(lateralAt(rightEdge, pts, i, i, 1, 2) - lateralAt(rightEdge, pts, i, i, 0, 2)),
        `right edge band at ${i}`,
      ).toBeCloseTo(rightBand, 6);
    }
  });
});

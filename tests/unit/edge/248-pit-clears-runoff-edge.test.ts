import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { PitLane, RunoffSegment, TrackDataV2 } from '../../../src/core/types';
import { pitBuildingPieces } from '../../../src/track/placement';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

// Variable specifier keeps typecheck green until task 248 adds the export (the 159 pattern).
const PIT_RANGE_MODULE = '../../../tools/track-builder/pitRange';

type ClipRunoffsFn = (
  runoffs: RunoffSegment[],
  centerline: Point2[],
  pit: PitLane,
  marginMeters: number,
) => RunoffSegment[];

async function loadClipRunoffs(): Promise<ClipRunoffsFn> {
  const mod = (await import(PIT_RANGE_MODULE)) as unknown as { clipRunoffsOutOfPit: ClipRunoffsFn };
  return mod.clipRunoffsOutOfPit;
}

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  id: 'straight',
  name: 'Straight',
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const FIVE_M: Point2[] = Array.from({ length: 100 }, (_, i): [number, number] => [i * 5, 0]);

const RIGHT_GRAVEL: RunoffSegment = { start: 0, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 };
const LEFT_RUNOFF: RunoffSegment = { start: 0, end: 99, side: 'left', surface: 'runoff', widthMeters: 30 };

const KEPT_0_4_36_99: number[] = [
  ...Array.from({ length: 5 }, (_, i) => i),
  ...Array.from({ length: 64 }, (_, i) => 36 + i),
];

function coveredIndices(segments: RunoffSegment[], n: number): number[] {
  const set = new Set<number>();
  for (const s of segments) {
    let i = ((s.start % n) + n) % n;
    const end = ((s.end % n) + n) % n;
    for (;;) {
      set.add(i);
      if (i === end) break;
      i = (i + 1) % n;
    }
  }
  return [...set].sort((a, b) => a - b);
}

function removedFrom(all: number[], kept: number[]): number[] {
  const k = new Set(kept);
  return all.filter((i) => !k.has(i));
}

function distToCenterline(track: TrackDataV2, x: number, z: number): number {
  const n = track.centerline.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = track.centerline[i];
    const b = track.centerline[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    best = Math.min(best, Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t)));
  }
  return best;
}

function nearFaceDist(p: { x: number; z: number; yaw: number; depth: number }, track: TrackDataV2): number {
  return distToCenterline(
    track,
    p.x - (p.depth / 2) * Math.sin(p.yaw),
    p.z - (p.depth / 2) * Math.cos(p.yaw),
  );
}

function expectPreChangeBox(track: TrackDataV2): void {
  const pieces = pitBuildingPieces(track);
  expect(pieces).toHaveLength(1);
  const p = pieces[0];
  expect(p.x).toBeCloseTo(200, 9);
  expect(p.z).toBeCloseTo(20, 9);
  expect(p.yaw).toBeCloseTo(0, 9);
  expect(p.length).toBeCloseTo(200, 9);
  expect(p.depth).toBeCloseTo(8, 9);
  expect(p.baseY).toBeCloseTo(0, 9);
  expect(p.plinthBottom).toBeCloseTo(-0.05, 9);
}

describe('248 pit clears runoff edges', () => {
  it('EDGE1: clipRunoffsOutOfPit leaves runoffs on the side opposite the pit untouched', async () => {
    const clip = await loadClipRunoffs();
    const out = clip([RIGHT_GRAVEL, { ...LEFT_RUNOFF }], STRAIGHT.centerline, STRAIGHT.pit, 50);
    const left = out.filter((s) => s.side === 'left');
    expect(left).toEqual([LEFT_RUNOFF]);
    const right = out.filter((s) => s.side === 'right');
    expect(coveredIndices(right, STRAIGHT.centerline.length)).toEqual(KEPT_0_4_36_99);
  });

  it('EDGE2: clipRunoffsOutOfPit returns the input unchanged when pit.start === pit.end', async () => {
    const clip = await loadClipRunoffs();
    const pit: PitLane = { start: 10, end: 10, side: 'right' };
    const out = clip([RIGHT_GRAVEL], STRAIGHT.centerline, pit, 50);
    expect(out).toEqual([RIGHT_GRAVEL]);
  });

  it('EDGE3: clipRunoffsOutOfPit does not mutate its inputs', async () => {
    const clip = await loadClipRunoffs();
    const runoffs: RunoffSegment[] = [RIGHT_GRAVEL, { ...LEFT_RUNOFF }];
    const centerline = STRAIGHT.centerline.map((p): [number, number] => [p[0], p[1]]);
    const pit: PitLane = { start: 10, end: 30, side: 'right' };
    const runoffsBefore = structuredClone(runoffs);
    const centerlineBefore = structuredClone(centerline);
    const pitBefore = structuredClone(pit);
    clip(runoffs, centerline, pit, 50);
    expect(runoffs).toEqual(runoffsBefore);
    expect(centerline).toEqual(centerlineBefore);
    expect(pit).toEqual(pitBefore);
  });

  it('EDGE4: a wrapping pit window removes a wrapping index set and keeps one maximal run 16..84', async () => {
    const clip = await loadClipRunoffs();
    const pit: PitLane = { start: 90, end: 10, side: 'right' };
    const out = clip([RIGHT_GRAVEL], STRAIGHT.centerline, pit, 50);
    const kept = coveredIndices(out, STRAIGHT.centerline.length);
    expect(removedFrom(Array.from({ length: 100 }, (_, i) => i), kept)).toEqual([
      ...Array.from({ length: 16 }, (_, i) => i),
      ...Array.from({ length: 15 }, (_, i) => 85 + i),
    ]);
    expect(out).toEqual([{ start: 16, end: 84, side: 'right', surface: 'gravel', widthMeters: 25 }]);
  });

  it('EDGE5: a wrapping runoff segment splits into its two kept runs across the seam', async () => {
    const clip = await loadClipRunoffs();
    const wrapping: RunoffSegment = { start: 90, end: 20, side: 'right', surface: 'gravel', widthMeters: 25 };
    const out = clip([wrapping], STRAIGHT.centerline, STRAIGHT.pit, 50);
    expect(out).toHaveLength(2);
    const runs = [...out].sort((a, b) => a.start - b.start);
    expect(runs).toEqual([
      { start: 0, end: 4, side: 'right', surface: 'gravel', widthMeters: 25 },
      { start: 90, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 },
    ]);
  });

  it('EDGE6: removal uses arc distance, not index count (5 m spacing drops 0..40)', async () => {
    const clip = await loadClipRunoffs();
    const out = clip([RIGHT_GRAVEL], FIVE_M, STRAIGHT.pit, 50);
    expect(out).toEqual([{ start: 41, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 }]);
  });

  it('EDGE7: a runoff fully inside the removed set contributes no segments', async () => {
    const clip = await loadClipRunoffs();
    const inner: RunoffSegment = { start: 12, end: 20, side: 'right', surface: 'gravel', widthMeters: 25 };
    expect(clip([inner], STRAIGHT.centerline, STRAIGHT.pit, 50)).toEqual([]);
  });

  it('EDGE8: several pit-side runoffs clip into maximal runs in input order with surface and width preserved', async () => {
    const clip = await loadClipRunoffs();
    const a: RunoffSegment = { start: 20, end: 70, side: 'right', surface: 'gravel', widthMeters: 25 };
    const b: RunoffSegment = { start: 0, end: 49, side: 'right', surface: 'runoff', widthMeters: 30 };
    const out = clip([a, b], STRAIGHT.centerline, STRAIGHT.pit, 50);
    expect(out).toEqual([
      { start: 36, end: 70, side: 'right', surface: 'gravel', widthMeters: 25 },
      { start: 0, end: 4, side: 'right', surface: 'runoff', widthMeters: 30 },
      { start: 36, end: 49, side: 'right', surface: 'runoff', widthMeters: 30 },
    ]);
  });

  it('EDGE9: pitBuildingPieces takes the max offset among overlapping pit-side barriers (near face 19)', () => {
    const track: TrackDataV2 = {
      ...STRAIGHT,
      barriers: [
        { start: 10, end: 30, side: 'right', type: 'armco', offsetMeters: 12 },
        { start: 10, end: 30, side: 'right', type: 'wall', offsetMeters: 18 },
      ],
    };
    const pieces = pitBuildingPieces(track);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const p of pieces) expect(nearFaceDist(p, STRAIGHT)).toBeCloseTo(19, 6);
  });

  it('EDGE10: pitBuildingPieces ignores barriers off the pit side and barriers not covering the pit vertices', () => {
    expectPreChangeBox({
      ...STRAIGHT,
      barriers: [{ start: 0, end: 99, side: 'left', type: 'armco', offsetMeters: 18 }],
    });
    expectPreChangeBox({
      ...STRAIGHT,
      barriers: [{ start: 60, end: 90, side: 'right', type: 'armco', offsetMeters: 18 }],
    });
  });
});

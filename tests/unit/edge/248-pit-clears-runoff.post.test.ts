import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunoffSegment, TrackDataV2 } from '../../../src/core/types';
import { pitBuildingPieces, type PitPiece } from '../../../src/track/placement';
import { clipRunoffsOutOfPit } from '../../../tools/track-builder/pitRange';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

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

const RIGHT_GRAVEL: RunoffSegment = { start: 0, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 };
const LEFT_RUNOFF: RunoffSegment = { start: 0, end: 99, side: 'left', surface: 'runoff', widthMeters: 30 };

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

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
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

// Near-face endpoints and midpoint of a piece.
function nearFaceDists(p: PitPiece, track: TrackDataV2): Array<{ dist: number; z: number }> {
  const nearX = p.x - (p.depth / 2) * Math.sin(p.yaw);
  const nearZ = p.z - (p.depth / 2) * Math.cos(p.yaw);
  return [-1, 0, 1].map((s) => {
    const x = nearX + ((s * p.length) / 2) * Math.cos(p.yaw);
    const z = nearZ - ((s * p.length) / 2) * Math.sin(p.yaw);
    return { dist: distToCenterline(track, x, z), z };
  });
}

function expectPreChangeBox(pieces: PitPiece[]): void {
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

describe('248 pit clears runoff post gaps', () => {
  it('GAP1: margin 0 removes exactly the pit window and nothing beyond it', () => {
    const out = clipRunoffsOutOfPit([RIGHT_GRAVEL], STRAIGHT.centerline, STRAIGHT.pit, 0);
    expect(out).toEqual([
      { start: 0, end: 9, side: 'right', surface: 'gravel', widthMeters: 25 },
      { start: 31, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 },
    ]);
    expect(coveredIndices(out, 100)).toEqual([...range(0, 9), ...range(31, 99)]);
  });

  it('GAP2: a negative margin behaves like margin 0 (window only)', () => {
    const zero = clipRunoffsOutOfPit([RIGHT_GRAVEL], STRAIGHT.centerline, STRAIGHT.pit, 0);
    const negative = clipRunoffsOutOfPit([RIGHT_GRAVEL], STRAIGHT.centerline, STRAIGHT.pit, -50);
    expect(negative).toEqual(zero);
  });

  it('GAP3: a margin larger than the loop removes every pit-side runoff and leaves the other side untouched', () => {
    const out = clipRunoffsOutOfPit([RIGHT_GRAVEL, LEFT_RUNOFF], STRAIGHT.centerline, STRAIGHT.pit, 10000);
    expect(out).toEqual([LEFT_RUNOFF]);
  });

  it('GAP4: a single-index runoff is kept outside the removed set and dropped inside it', () => {
    const out = clipRunoffsOutOfPit(
      [
        { start: 40, end: 40, side: 'right', surface: 'gravel', widthMeters: 25 },
        { start: 20, end: 20, side: 'right', surface: 'runoff', widthMeters: 30 },
      ],
      STRAIGHT.centerline,
      STRAIGHT.pit,
      50,
    );
    expect(out).toEqual([{ start: 40, end: 40, side: 'right', surface: 'gravel', widthMeters: 25 }]);
  });

  it('GAP5: with a left-side pit the left runoffs clip and the right runoffs pass through untouched', () => {
    const pit = { start: 10, end: 30, side: 'left' } as const;
    const out = clipRunoffsOutOfPit([RIGHT_GRAVEL, LEFT_RUNOFF], STRAIGHT.centerline, pit, 50);
    expect(out.filter((s) => s.side === 'right')).toEqual([RIGHT_GRAVEL]);
    expect(coveredIndices(out.filter((s) => s.side === 'left'), 100)).toEqual([
      ...range(0, 4),
      ...range(36, 99),
    ]);
  });

  it('GAP6: an empty runoff list clips to an empty list', () => {
    expect(clipRunoffsOutOfPit([], STRAIGHT.centerline, STRAIGHT.pit, 50)).toEqual([]);
  });

  it('GAP7: every built track ships runoffs already clipped out of its pit window (clip is a no-op on them)', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    for (const { id } of index) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      const out = clipRunoffsOutOfPit(track.runoffs, track.centerline, track.pit, 50);
      expect(out, `${id}: pit-window runoffs were not clipped at build time`).toEqual(track.runoffs);
    }
  }, 60000);

  it('GAP8: a pit-side barrier at base-1 keeps the pre-change box, one metre higher pushes the near face to 17', () => {
    const base = 16;
    const low = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: base - 1 }],
    });
    expectPreChangeBox(low);
    const high = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: base }],
    });
    expect(high).toHaveLength(1);
    for (const { dist } of nearFaceDists(high[0], STRAIGHT)) expect(dist).toBeCloseTo(base + 1, 6);
  });

  it('GAP9: a barrier covering only the middle of the window still gives the whole piece a uniform near face at 19', () => {
    const pieces = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 15, end: 25, side: 'right', type: 'wall', offsetMeters: 18 }],
    });
    expect(pieces).toHaveLength(1);
    for (const { dist } of nearFaceDists(pieces[0], STRAIGHT)) expect(dist).toBeCloseTo(19, 6);
  });

  it('GAP10: wrapping barriers are wrap-aware — covering the window start pushes out, stopping short of it does not', () => {
    const covering = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 90, end: 15, side: 'right', type: 'wall', offsetMeters: 18 }],
    });
    expect(covering).toHaveLength(1);
    for (const { dist } of nearFaceDists(covering[0], STRAIGHT)) expect(dist).toBeCloseTo(19, 6);
    const clear = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 40, end: 8, side: 'right', type: 'wall', offsetMeters: 18 }],
    });
    expectPreChangeBox(clear);
  });

  it('GAP11: a left-side pit with a left barrier at offset 18 puts the near face on the left at distance 19', () => {
    const pieces = pitBuildingPieces({
      ...STRAIGHT,
      pit: { start: 10, end: 30, side: 'left' },
      barriers: [{ start: 0, end: 99, side: 'left', type: 'wall', offsetMeters: 18 }],
    });
    expect(pieces).toHaveLength(1);
    for (const { dist, z } of nearFaceDists(pieces[0], STRAIGHT)) {
      expect(dist).toBeCloseTo(19, 6);
      expect(z).toBeLessThan(0);
    }
  });

  it('GAP12: the max barrier offset wins regardless of barrier list order', () => {
    const pieces = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [
        { start: 10, end: 30, side: 'right', type: 'wall', offsetMeters: 18 },
        { start: 10, end: 30, side: 'right', type: 'armco', offsetMeters: 12 },
      ],
    });
    expect(pieces).toHaveLength(1);
    for (const { dist } of nearFaceDists(pieces[0], STRAIGHT)) expect(dist).toBeCloseTo(19, 6);
  });

  it('GAP13: a negative barrier offset never pulls the building in below the base offset', () => {
    const pieces = pitBuildingPieces({
      ...STRAIGHT,
      barriers: [{ start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: -5 }],
    });
    expectPreChangeBox(pieces);
  });
});

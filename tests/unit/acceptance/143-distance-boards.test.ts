import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardOffset, buildBoards } from '../../../tools/track-builder/boards';
import { detectCorners } from '../../../tools/track-builder/corners';
import type { Point2 } from '../../../src/track/geo';
import type { Side, TrackDataV2 } from '../../../src/core/types';

// Mirrors task 143's Board / TrackDataV2.boards so this test-first file
// also type-checks until types.ts is updated.
interface Board143 {
  index: number;
  side: Side;
  offset: number;
  label: 50 | 100 | 150 | 200;
}
type TrackV2_143 = TrackDataV2 & { boards?: Board143[] };

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const inRun = (run: { start: number; end: number }, i: number, n: number) =>
  wrap(i - run.start, n) <= wrap(run.end - run.start, n);

// Rounded square: 4 straights of 600 m + 4 quarter-circle arcs of radius R, ~2 m spacing.
function roundedSquare(R: number): Point2[] {
  const L = 600 + 2 * R;
  const pts: Point2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    const k = Math.round(((Math.PI / 2) * R) / 2);
    for (let j = 1; j <= k; j++) {
      const a = ((a0 + (90 * j) / k) * Math.PI) / 180;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  };
  for (let i = 1; i <= 300; i++) pts.push([R + 2 * i, 0]);
  arc(L - R, R, -90);
  for (let i = 1; i <= 300; i++) pts.push([L, R + 2 * i]);
  arc(L - R, L - R, 0);
  for (let i = 1; i <= 300; i++) pts.push([L - R - 2 * i, L]);
  arc(R, L - R, 90);
  for (let i = 1; i <= 300; i++) pts.push([0, L - R - 2 * i]);
  arc(R, R, 180);
  return pts;
}

function cumulative(points: Point2[]): { cum: number[]; lap: number } {
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const n = points.length;
  const lap = cum[n - 1] + Math.hypot(points[0][0] - points[n - 1][0], points[0][1] - points[n - 1][1]);
  return { cum, lap };
}

function arcDistance(a: number, b: number, lap: number): number {
  const d = wrap(a - b, lap);
  return Math.min(d, lap - d);
}

// One board with `label` per run, at run start − label (± 2 m along the centerline).
function expectPerRun(
  boards: Board143[],
  pts: Point2[],
  labels: number[],
  checkSide: boolean,
): void {
  const { cum, lap } = cumulative(pts);
  const runs = detectCorners(pts);
  expect(runs).toHaveLength(4);
  for (const run of runs) {
    for (const label of labels) {
      const target = wrap(cum[run.start] - label, lap);
      const at = boards.filter(
        (b) => b.label === label && arcDistance(cum[b.index], target, lap) <= 2,
      );
      expect(at, `label ${label} before run ${run.start}`).toHaveLength(1);
      if (checkSide) expect(at[0].side).toBe(opp(run.side));
    }
  }
}

const ROOT = join(__dirname, '..', '..', '..');

describe('143 distance boards acceptance', () => {
  it('AT1: rounded square with 600 m straights and R 30 arcs gives 16 boards: per arc labels 200, 150, 100, 50 at run start − label (± 2 m), all on the outside side', () => {
    const pts = roundedSquare(30);
    const boards = buildBoards(pts, 12, []);
    expect(boards).toHaveLength(16);
    expectPerRun(boards, pts, [200, 150, 100, 50], true);
  });

  it('AT2: rounded square with R 300 arcs gives 12 boards (150, 100, 50 per arc); with R 500 arcs it gives none', () => {
    const pts = roundedSquare(300);
    const boards = buildBoards(pts, 12, []);
    expect(boards).toHaveLength(12);
    expect(boards.filter((b) => b.label === 200)).toHaveLength(0);
    expectPerRun(boards, pts, [150, 100, 50], false);
    expect(buildBoards(roundedSquare(500), 12, [])).toHaveLength(0);
  });

  it('AT3: boardOffset is max(half + 1.2 + 2, min(barrier − 1, half + 6)): 9.2 for offset 9 half 6, 12 for offset 30 half 6', () => {
    expect(boardOffset(6, 9)).toBeCloseTo(9.2, 9);
    expect(boardOffset(6, 30)).toBeCloseTo(12, 9);
  });

  it('AT4: rebuilt monza has at least 18 boards and no board index lies inside a corner run', () => {
    const track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8'),
    ) as TrackV2_143;
    const boards = track.boards ?? [];
    expect(boards.length).toBeGreaterThanOrEqual(18);
    const n = track.centerline.length;
    const runs = detectCorners(track.centerline);
    for (const b of boards) {
      expect(runs.some((r) => inRun(r, b.index, n)), `board index ${b.index} inside a corner run`).toBe(false);
    }
  });
});

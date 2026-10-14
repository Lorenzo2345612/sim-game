import type { Point2 } from '../../src/track/geo';
import type { BarrierSegment, Board, Side } from '../../src/core/types';
import { KERB_WIDTH } from '../../src/core/constants';
import { classifyCorners } from './hazards';

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

const LABELS_HEAVY: Board['label'][] = [200, 150, 100, 50];
const LABELS_MEDIUM: Board['label'][] = [150, 100, 50];

export function boardOffset(halfWidth: number, outsideBarrierOffset: number): number {
  return Math.max(halfWidth + KERB_WIDTH + 2, Math.min(outsideBarrierOffset - 1, halfWidth + 6));
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

function coversIndex(seg: { start: number; end: number }, i: number, n: number): boolean {
  return wrap(i - seg.start, n) <= wrap(seg.end - seg.start, n);
}

function nearestIndex(cum: number[], lap: number, target: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < cum.length; i++) {
    const d = wrap(cum[i] - target, lap);
    const dist = Math.min(d, lap - d);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function buildBoards(points: Point2[], widthMeters: number, barriers: BarrierSegment[]): Board[] {
  const n = points.length;
  if (n < 3) return [];
  const { cum, lap } = cumulative(points);
  const corners = classifyCorners(points);
  const half = widthMeters / 2;
  const out: Board[] = [];
  for (let c = 0; c < corners.length; c++) {
    const corner = corners[c];
    if (corner.dropKmh < 40) continue;
    const labels = corner.dropKmh >= 120 ? LABELS_HEAVY : LABELS_MEDIUM;
    const side = opposite(corner.side);
    for (const label of labels) {
      const index = nearestIndex(cum, lap, wrap(cum[corner.start] - label, lap));
      // AT4: a board never sits inside a corner run (chicane clusters reach past the immediate previous run).
      if (corners.some((r) => coversIndex(r, index, n))) continue;
      const barrier = barriers.find((b) => b.side === side && coversIndex(b, index, n));
      out.push({
        index,
        side,
        offset: barrier ? boardOffset(half, barrier.offsetMeters) : half + 7,
        label,
      });
    }
  }
  return out.sort((a, b) => a.index - b.index || b.label - a.label);
}

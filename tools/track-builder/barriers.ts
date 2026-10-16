import type { Point2 } from '../../src/track/geo';
import { KERB_WIDTH, VERGE_WIDTH, BARRIER_GAP } from '../../src/core/constants';
import type { BarrierSegment, TrackSegment, RunoffSegment, PitLane, Side, EnvironmentType } from '../../src/core/types';

function covers(start: number, end: number, i: number): boolean {
  return end >= start ? i >= start && i <= end : i >= start || i <= end;
}

function maxWidthAt(segments: RunoffSegment[], side: Side, i: number): number | null {
  let max: number | null = null;
  for (const s of segments) {
    if (s.side === side && covers(s.start, s.end, i) && (max === null || s.widthMeters > max)) {
      max = s.widthMeters;
    }
  }
  return max;
}

export function layoutBarriers(
  centerline: Point2[], widthMeters: number,
  kerbs: TrackSegment[], runoffs: RunoffSegment[], pit?: PitLane,
  environment?: EnvironmentType,
): BarrierSegment[] {
  const n = centerline.length;
  const hasKerb = (side: Side, i: number) =>
    kerbs.some((k) => k.side === side && covers(k.start, k.end, i));

  const out: BarrierSegment[] = [];
  for (const side of ['left', 'right'] as const) {
    let current: BarrierSegment | null = null;
    for (let i = 0; i < n; i++) {
      const runoffWidth = maxWidthAt(runoffs, side, i);
      const offset = Math.round(
        (widthMeters / 2 + (hasKerb(side, i) ? KERB_WIDTH : 0) +
          (runoffWidth ?? VERGE_WIDTH) + BARRIER_GAP) * 2,
      ) / 2;
      // City circuits are walls all round; applyFoamBarriers runs afterwards and keeps its foam.
      const type: BarrierSegment['type'] =
        environment === 'city' || (pit && pit.side === side && covers(pit.start, pit.end, i))
          ? 'wall'
          : runoffs.some((r) => r.surface === 'gravel' && r.side === side && covers(r.start, r.end, i))
            ? 'tyres'
            : 'armco';
      if (current && current.type === type && current.offsetMeters === offset) {
        current.end = i;
      } else {
        current = { start: i, end: i, side, type, offsetMeters: offset };
        out.push(current);
      }
    }
  }
  return out;
}

import { describe, it, expect } from 'vitest';
import { layoutBarriers } from '../../../tools/track-builder/barriers';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, RunoffSegment, TrackSegment } from '../../../src/core/types';

function closedLoop(n: number): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([50 * Math.cos(a), 50 * Math.sin(a)]);
  }
  return pts;
}

// inclusive [start, end], wrap-aware (end < start)
function covers(start: number, end: number, i: number, n: number): boolean {
  return end >= start ? i >= start && i <= end : i >= start || i <= end;
}

function covering(out: BarrierSegment[], side: 'left' | 'right', i: number, n: number): BarrierSegment[] {
  return out.filter((s) => s.side === side && covers(s.start, s.end, i, n));
}

describe('027 barrier layout acceptance', () => {
  it('AT1: loop with no corners, width 12, no kerbs or runoffs -> left and right armco at 11 m covering the whole lap', () => {
    const n = 40;
    const out: BarrierSegment[] = layoutBarriers(closedLoop(n), 12, [], []);
    expect(out).toHaveLength(2);
    for (const side of ['left', 'right'] as const) {
      const segs = covering(out, side, 0, n);
      expect(segs).toHaveLength(1);
      expect(segs[0]).toMatchObject({ start: 0, end: n - 1, side, type: 'armco' });
      expect(segs[0].offsetMeters).toBeCloseTo(6 + 4 + 1, 9);
    }
  });

  it('AT2: gravel runoff 18 m on the right of indices 100-150 (+ kerb) -> right 100-150 is tyres at 26 m', () => {
    const n = 200;
    const kerbs: TrackSegment[] = [{ start: 100, end: 150, side: 'right' }];
    const runoffs: RunoffSegment[] = [{ start: 100, end: 150, side: 'right', surface: 'gravel', widthMeters: 18 }];
    const out: BarrierSegment[] = layoutBarriers(closedLoop(n), 12, kerbs, runoffs);
    const segs = covering(out, 'right', 125, n);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 100, end: 150, side: 'right', type: 'tyres' });
    expect(segs[0].offsetMeters).toBeCloseTo(26, 9); // 6 + 1.2 + 18 + 1 = 26.2 -> 26
  });

  it('AT3: pit {start 10, end 60, side left} -> left 10-60 is wall', () => {
    const n = 100;
    const out: BarrierSegment[] = layoutBarriers(closedLoop(n), 12, [], [], { start: 10, end: 60, side: 'left' });
    const segs = covering(out, 'left', 35, n);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 10, end: 60, side: 'left', type: 'wall' });
  });

  it('AT4: consecutive points with equal type and offset are merged; every index of each side covered exactly once', () => {
    const n = 50;
    const kerbs: TrackSegment[] = [{ start: 20, end: 29, side: 'left' }];
    const runoffs: RunoffSegment[] = [{ start: 35, end: 44, side: 'right', surface: 'gravel', widthMeters: 8 }];
    const out: BarrierSegment[] = layoutBarriers(closedLoop(n), 10, kerbs, runoffs);
    for (const side of ['left', 'right'] as const) {
      for (let i = 0; i < n; i++) {
        expect(covering(out, side, i, n), `${side} index ${i} coverage`).toHaveLength(1);
      }
    }
    // 20 consecutive equal points merged into one segment, not 20
    expect(out.filter((s) => s.side === 'left')).toContainEqual(expect.objectContaining({ start: 0, end: 19 }));
    expect(out.filter((s) => s.side === 'right')).toContainEqual(expect.objectContaining({ start: 0, end: 34 }));
  });
});

import { describe, it, expect } from 'vitest';
import type { LapEvent } from '../../../src/core/types';
import type { Point2 } from '../../../src/track/geo';
import { resampleClosed } from '../../../src/track/centerline';
import { TrackProgress } from '../../../src/track/trackProgress';
import { LapTimer } from '../../../src/track/lapTimer';

const L = 1000;
const SECTORS: [number, number, number] = [0, 333, 666];

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function sig(e: LapEvent): string {
  return e.type === 'lapStarted'
    ? `lapStarted/${e.lap}`
    : e.type === 'lapCompleted'
      ? `lapCompleted/${e.lap}`
      : `sectorCompleted/${e.sector}`;
}

function circle(r: number, n: number): Point2[] {
  const out: Point2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

function drive(
  timer: LapTimer,
  events: LapEvent[],
  steps: number,
  dt: number,
  startDistance: number,
  startTime: number,
): void {
  for (let k = 0; k < steps; k++) {
    events.push(...timer.update((startDistance + k) % L, startTime + k * dt));
  }
}

function completedOf(events: LapEvent[]): Extract<LapEvent, { type: 'lapCompleted' }>[] {
  return events.flatMap(e => (e.type === 'lapCompleted' ? [e] : []));
}

const TRACK: Point2[] = resampleClosed(circle(100, 64), 2);

describe('008 post-code edge cases', () => {
  it('forward wrap needs prev strictly above L-50 and distance strictly below 50', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(960, 0)).toEqual([]);
    expect(timer.update(50, 1)).toEqual([]); // distance 50 is not strictly < 50
    expect(timer.update(950, 2)).toEqual([]);
    expect(timer.update(49, 3)).toEqual([]); // prev 950 is not strictly > 950
    expect(timer.lap).toBe(0);
    expect(timer.update(951, 4)).toEqual([]); // backward at lap 0 changes nothing
    expect(timer.update(49, 5).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(50, 6)).toEqual([]); // forward needs distance strictly < 50
  });

  it('prev exactly 50 is not a backward wrap, so the crossing completes the lap', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(999, 0)).toEqual([]);
    expect(timer.update(49, 1).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(50, 2)).toEqual([]);
    // 50 -> 960 is not backward (prev not < 50); the sector loop uses the
    // captured prev for both lines, so sectors 1 and 2 fire in this update.
    expect(timer.update(960, 3).map(sig)).toEqual(['sectorCompleted/1', 'sectorCompleted/2']);
    expect(timer.update(49, 4).map(sig)).toEqual([
      'sectorCompleted/3',
      'lapCompleted/1',
      'lapStarted/2',
    ]);
    expect(timer.lastLapTime).toBeCloseTo(3, 10);
  });

  it('prev below 50 jumping past L-50 is backward and short-circuits sector tracking', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(999, 0)).toEqual([]);
    expect(timer.update(49, 1).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(960, 2)).toEqual([]); // backward returns before the sector loop
    expect(timer.update(49, 3).map(sig)).toEqual(['lapStarted/2']);
    expect(timer.lastLapTime).toBe(null);
  });

  it('a forward crossing with sector 2 pending starts a new lap without completing', () => {
    const timer = new LapTimer(L, [0, 960, 995]);
    expect(timer.update(999, 0)).toEqual([]);
    expect(timer.update(1, 10).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(500, 11)).toEqual([]);
    expect(timer.update(961, 12).map(sig)).toEqual(['sectorCompleted/1']);
    expect(timer.update(994, 13)).toEqual([]); // sector 2 at 995 not reached
    const crossing = timer.update(2, 14); // forward with nextSector === 2
    expect(crossing.map(sig)).toEqual(['lapStarted/2']);
    expect(completedOf(crossing).length).toBe(0);
    expect(timer.lap).toBe(2);
    expect(timer.lastLapTime).toBe(null);
    expect(timer.bestLapTime).toBe(null);
    expect(timer.update(400, 15)).toEqual([]);
    expect(timer.update(961, 16).map(sig)).toEqual(['sectorCompleted/1']); // nextSector was reset
  });

  it('an invalidated lap does not prevent the next lap from completing', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.update(999, 0)).toEqual([]);
    expect(timer.update(49, 1).map(sig)).toEqual(['lapStarted/1']);
    expect(timer.update(990, 2)).toEqual([]); // backward -> invalid
    expect(timer.update(5, 3).map(sig)).toEqual(['lapStarted/2']); // invalid cleared here
    expect(timer.update(340, 4).map(sig)).toEqual(['sectorCompleted/1']);
    expect(timer.update(670, 5).map(sig)).toEqual(['sectorCompleted/2']);
    expect(timer.update(999, 6)).toEqual([]);
    expect(timer.update(1, 7).map(sig)).toEqual([
      'sectorCompleted/3',
      'lapCompleted/2',
      'lapStarted/3',
    ]);
    expect(timer.lastLapTime).toBeCloseTo(4, 10);
  });

  it('an exactly equal lap time is not the best', () => {
    const dt = 1 / 128; // exact in binary, so both lapTimes are exactly 1000*dt
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, dt, 990, 0);
    drive(timer, events, 1000, dt, 1, 1011 * dt);
    const done = completedOf(events);
    expect(done.length).toBe(2);
    within(done[0].lapTime, 7.8125, 1e-9);
    within(done[1].lapTime, 7.8125, 1e-9);
    expect(done[0].isBest).toBe(true);
    expect(done[1].isBest).toBe(false);
    within(timer.bestLapTime!, 7.8125, 1e-9);
  });

  it('an all-degenerate centerline returns the zero sample without throwing', () => {
    const tp = new TrackProgress([[7, 7], [7, 7], [7, 7]]);
    expect(tp.length).toBe(0);
    expect(() => tp.update(3, 4)).not.toThrow();
    const s = tp.update(3, 4);
    expect(s.index).toBe(0);
    expect(s.distance).toBe(0);
    expect(s.lateral).toBe(0);
    expect(Number.isFinite(s.distance) && Number.isFinite(s.lateral)).toBe(true);
    tp.reset();
    within(tp.update(100, 0).distance, 0, 0);
  });

  it('the local window tracks a pass across the start line without a reset', () => {
    const tp = new TrackProgress(TRACK);
    expect(tp.update(100, 0).index).toBe(0); // global first call, lastIndex = 0
    const back = (tp.length - 1) / 100; // 1 m before the start line, ~313 segments back
    const s = tp.update(100 * Math.cos(back), 100 * Math.sin(back));
    within(s.distance, tp.length - 1, 1); // window wrapped modulo below index 0
    within(s.lateral, 0, 0.5);
    // exactly on P0 both the closing segment (t=1) and segment 0 (t=0) project
    // to the point; a 0.5 m pass forward unambiguously lands on segment 0.
    const cross = tp.update(100 * Math.cos(0.005), 100 * Math.sin(0.005));
    expect(cross.index).toBe(0);
    within(cross.distance, 0.5, 0.2);
  });
});

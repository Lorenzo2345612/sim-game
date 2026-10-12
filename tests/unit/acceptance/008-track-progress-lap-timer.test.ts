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

const TRACK: Point2[] = resampleClosed(circle(100, 64), 2);

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

describe('008 track progress and lap timer acceptance', () => {
  it('AT1: update at the start point gives index 0, distance 0 and lateral 0', () => {
    const tp = new TrackProgress(TRACK);
    const s = tp.update(100, 0);
    expect(s.index).toBe(0);
    within(s.distance, 0, 0.5);
    within(s.lateral, 0, 0.1);
  });

  it('AT2: points every 10 m of arc give monotonically increasing distance matching arc length', () => {
    const tp = new TrackProgress(TRACK);
    let prev = -1;
    for (let arc = 0; arc <= 620; arc += 10) {
      const a = arc / 100;
      const s = tp.update(100 * Math.cos(a), 100 * Math.sin(a));
      within(s.distance, arc, 1);
      expect(s.distance).toBeGreaterThan(prev);
      prev = s.distance;
    }
  });

  it('AT3: radius 105 vs 95 at the same angle give opposite-sign lateral of magnitude 5', () => {
    const tp = new TrackProgress(TRACK);
    const a = 1;
    const outerLateral = tp.update(105 * Math.cos(a), 105 * Math.sin(a)).lateral;
    const innerLateral = tp.update(95 * Math.cos(a), 95 * Math.sin(a)).lateral;
    within(Math.abs(outerLateral), 5, 0.2);
    within(Math.abs(innerLateral), 5, 0.2);
    expect(outerLateral * innerLateral).toBeLessThan(0);
  });

  it('AT4: the first forward wrap emits lapStarted lap 1', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 11, 0.01, 990, 0);
    expect(events.map(sig)).toEqual(['lapStarted/1']);
    expect(timer.lap).toBe(1);
  });

  it('AT5: one full lap emits sectorCompleted 1, 2, 3 then lapCompleted then lapStarted lap 2', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    expect(events.map(sig)).toEqual([
      'lapStarted/1',
      'sectorCompleted/1',
      'sectorCompleted/2',
      'sectorCompleted/3',
      'lapCompleted/1',
      'lapStarted/2',
    ]);
    const completed = completedOf(events);
    expect(completed.length).toBe(1);
    within(completed[0].lapTime, 10, 0.02);
    expect(completed[0].isBest).toBe(true);
  });

  it('AT6: a jump from 300 to 700 in one update emits sectors 1 and 2 in that update', () => {
    const timer = new LapTimer(L, SECTORS);
    drive(timer, [], 1011, 0.01, 990, 0);
    expect(timer.update(300, 10.11)).toEqual([]);
    const jump = timer.update(700, 10.12);
    expect(jump.map(sig)).toEqual(['sectorCompleted/1', 'sectorCompleted/2']);
  });

  it('AT7: a backward wrap then a forward crossing emits only lapStarted lap 3, no lapCompleted for lap 2', () => {
    const timer = new LapTimer(L, SECTORS);
    drive(timer, [], 1011, 0.01, 990, 0);
    const events: LapEvent[] = [];
    events.push(...timer.update(20, 10.11));
    events.push(...timer.update(990, 10.12));
    events.push(...timer.update(5, 10.13));
    expect(events.map(sig)).toEqual(['lapStarted/3']);
    expect(completedOf(events).length).toBe(0);
  });

  it('AT8: with a slower second lap, lastLapTime is the second and bestLapTime is the first', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    drive(timer, events, 1000, 0.02, 1, 10.11);
    const completed = completedOf(events);
    expect(completed.length).toBe(2);
    expect(completed[1].lapTime).toBeGreaterThan(completed[0].lapTime);
    expect(timer.lastLapTime).toBe(completed[1].lapTime);
    expect(timer.bestLapTime).toBe(completed[0].lapTime);
  });

  it('AT9: reset gives lap 0, null currentLapTime, and the next forward crossing emits lapStarted lap 1', () => {
    const timer = new LapTimer(L, SECTORS);
    drive(timer, [], 1011, 0.01, 990, 0);
    timer.reset();
    expect(timer.lap).toBe(0);
    expect(timer.currentLapTime(99.9)).toBe(null);
    const events: LapEvent[] = [];
    drive(timer, events, 11, 0.01, 990, 50);
    expect(events.map(sig)).toEqual(['lapStarted/1']);
  });
});

import { describe, it, expect } from 'vitest';
import type { LapEvent } from '../../../src/core/types';
import { LapTimer } from '../../../src/track/lapTimer';

const L = 1000;
const SECTORS: [number, number, number] = [0, 333, 666];

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

function sig(e: LapEvent): string {
  return e.type === 'lapStarted'
    ? `lapStarted/${e.lap}`
    : e.type === 'lapCompleted'
      ? `lapCompleted/${e.lap}`
      : `sectorCompleted/${e.sector}`;
}

function completed(events: LapEvent[]): Extract<LapEvent, { type: 'lapCompleted' }>[] {
  return events.flatMap(e => (e.type === 'lapCompleted' ? [e] : []));
}

describe('LapTimer', () => {
  it('no events before first crossing', () => {
    const timer = new LapTimer(L, SECTORS);
    for (let k = 0; k < 9; k++) {
      expect(timer.update(990 + k, k * 0.01)).toEqual([]);
    }
    expect(timer.lap).toBe(0);
    expect(timer.currentLapTime(1)).toBe(null);
  });

  it('first crossing starts lap 1', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 11, 0.01, 990, 0);
    expect(events.map(sig)).toEqual(['lapStarted/1']);
    expect(timer.lap).toBe(1);
  });

  it('first full lap takes 10.00 s and sector times add up', () => {
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
    const done = completed(events)[0];
    expect(done.lapTime).toBeCloseTo(10, 2);
    expect(done.isBest).toBe(true);
    expect(timer.lastLapTime).toBeCloseTo(10, 2);
    expect(timer.bestLapTime).toBeCloseTo(10, 2);
    const sectors = events.flatMap(e =>
      e.type === 'sectorCompleted' && e.lap === 1 ? [e.sectorTime] : [],
    );
    expect(sectors.length).toBe(3);
    const sum = sectors.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(done.lapTime, 2);
  });

  it('best only updates with a faster lap', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    expect(timer.bestLapTime).toBeCloseTo(10, 1);
    drive(timer, events, 1000, 0.02, 1, 10.11);
    expect(timer.bestLapTime).toBeCloseTo(10, 1);
    drive(timer, events, 1000, 0.005, 1, 30.10);
    expect(timer.bestLapTime).toBeCloseTo(5, 1);
    expect(completed(events).map(e => e.isBest)).toEqual([true, false, true]);
  });

  it('crossing the line backwards invalidates the lap', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    const before = timer.lastLapTime;
    const after: LapEvent[] = [];
    after.push(...timer.update(10, 10.11));
    after.push(...timer.update(995, 10.12));
    after.push(...timer.update(5, 10.13));
    expect(after.map(sig)).toEqual(['lapStarted/3']);
    expect(completed(after).length).toBe(0);
    expect(timer.lastLapTime).toBe(before);
  });

  it('lastLapTime and bestLapTime track the slower and faster lap', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    drive(timer, events, 1000, 0.02, 1, 10.11);
    expect(completed(events).length).toBe(2);
    expect(timer.lastLapTime).toBeCloseTo(20, 1);
    expect(timer.bestLapTime).toBeCloseTo(10, 1);
  });

  it('a jump over several sectors counts them', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 11, 0.01, 990, 0);
    expect(timer.update(300, 0.11)).toEqual([]);
    const jump = timer.update(700, 0.12);
    expect(jump.map(sig)).toEqual(['sectorCompleted/1', 'sectorCompleted/2']);
  });

  it('reset returns to lap 0', () => {
    const timer = new LapTimer(L, SECTORS);
    const events: LapEvent[] = [];
    drive(timer, events, 1011, 0.01, 990, 0);
    timer.reset();
    expect(timer.lap).toBe(0);
    expect(timer.lastLapTime).toBe(null);
    expect(timer.bestLapTime).toBe(null);
    expect(timer.update(20, 50)).toEqual([]);
    expect(timer.currentLapTime(50)).toBe(null);
  });
});

import { describe, it, expect } from 'vitest';
import { LapTimer } from '../../../src/track/lapTimer';

const L = 1000;
const SECTORS: [number, number, number] = [0, 333, 666];

function startLap(timer: LapTimer): void {
  timer.update(995, 0);
  timer.update(5, 0.01);
}

describe('LapTimer invalidation', () => {
  it('invalidate at lap 0 returns [] and keeps the timer valid', () => {
    const timer = new LapTimer(L, SECTORS);
    expect(timer.valid).toBe(true);
    expect(timer.invalidate()).toEqual([]);
    expect(timer.valid).toBe(true);
  });

  it('second invalidate in the same lap returns []', () => {
    const timer = new LapTimer(L, SECTORS);
    startLap(timer);
    expect(timer.invalidate()).toEqual([{ type: 'lapInvalidated', lap: 1 }]);
    expect(timer.valid).toBe(false);
    expect(timer.invalidate()).toEqual([]);
    expect(timer.valid).toBe(false);
  });

  it('valid is true again after the next lapStarted', () => {
    const timer = new LapTimer(L, SECTORS);
    startLap(timer);
    timer.invalidate();
    timer.update(990, 10.1);
    const events = timer.update(5, 10.11);
    expect(events.some((e) => e.type === 'lapStarted' && e.lap === 2)).toBe(true);
    expect(events.some((e) => e.type === 'lapCompleted')).toBe(false);
    expect(timer.valid).toBe(true);
  });

  it('reset makes the timer valid again', () => {
    const timer = new LapTimer(L, SECTORS);
    startLap(timer);
    timer.invalidate();
    expect(timer.valid).toBe(false);
    timer.reset();
    expect(timer.valid).toBe(true);
  });
});

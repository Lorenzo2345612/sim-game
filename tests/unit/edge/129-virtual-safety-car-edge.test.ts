import { describe, it, expect } from 'vitest';
import { Vsc } from '../../../src/race/vsc';

const L = 1000;

function constantVsc(profileMs: number, carCount = 1, n = 10): Vsc {
  const speeds = new Float64Array(n).fill(profileMs);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) dist[i] = (i * L) / n;
  return new Vsc(speeds, dist, L, carCount);
}

// Over-speeds car 0 at 35 m/s (reference pace is 30 m/s) until the +5 s event fires.
function speedUntilEvent(vsc: Vsc): void {
  vsc.delta(0, 0, 0);
  vsc.delta(0, 35, 1);
  vsc.delta(0, 70, 2);
  vsc.delta(0, 105, 3);
  vsc.delta(0, 140, 4);
}

describe('129 virtual safety car edge', () => {
  it('EDGE1: empty profile or mismatched lengths throws Error', () => {
    expect(() => new Vsc(new Float64Array(0), new Float64Array(0), L, 1)).toThrow(Error);
    expect(() => new Vsc(new Float64Array(3), new Float64Array(2), L, 1)).toThrow(Error);
  });

  it('EDGE2: constructor and updates do not mutate the speed and distance inputs', () => {
    const speeds = Float64Array.from([20, 40, 30]);
    const dist = Float64Array.from([0, 400, 800]);
    const beforeS = Array.from(speeds);
    const beforeD = Array.from(dist);
    const vsc = new Vsc(speeds, dist, L, 1);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    vsc.delta(0, 400, 5);
    vsc.drainEvents();
    expect(Array.from(speeds)).toEqual(beforeS);
    expect(Array.from(dist)).toEqual(beforeD);
  });

  it('EDGE3: cause reappearing during ending redeploys and the next clear restarts the 5 s', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    expect(vsc.phase).toBe('deployed');
    vsc.update(0, 10);
    expect(vsc.phase).toBe('ending');
    vsc.update(1, 12);
    expect(vsc.phase).toBe('deployed');
    vsc.update(0, 20);
    vsc.update(0, 24.9);
    expect(vsc.phase).toBe('ending');
    vsc.update(0, 25.1);
    expect(vsc.phase).toBe('off');
  });

  it('EDGE4: phase goes off exactly at clearTime + 5 s', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.update(0, 10);
    expect(vsc.phase).toBe('ending');
    vsc.update(0, 15);
    expect(vsc.phase).toBe('off');
  });

  it('EDGE5: going off resets car state; a second deployment can fire one new +5 s event', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    speedUntilEvent(vsc);
    expect(vsc.drainEvents()).toHaveLength(1);
    vsc.delta(0, 140, 4);
    expect(vsc.drainEvents()).toHaveLength(0);
    vsc.update(0, 5);
    vsc.update(0, 10.1);
    expect(vsc.phase).toBe('off');
    expect(vsc.delta(0, 200, 11)).toBeCloseTo(0, 12);
    vsc.update(10, 12);
    expect(vsc.delta(0, 200, 12)).toBeCloseTo(0, 12);
    vsc.delta(0, 235, 13);
    vsc.delta(0, 270, 14);
    vsc.delta(0, 305, 15);
    const events = vsc.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].car).toBe(0);
    expect(events[0].seconds).toBe(5);
  });

  it('EDGE6: forward lap wrap counts the wrapped distance', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 990, 0);
    const d = vsc.delta(0, 10, 20 / 30);
    expect(d).toBeCloseTo(0, 9);
  });

  it('EDGE7: reference pace interpolates linearly between points and across the lap seam', () => {
    const vsc = new Vsc(Float64Array.from([20, 40]), Float64Array.from([0, 500]), L, 1);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    const d1 = vsc.delta(0, 100, 100 / (0.6 * 24));
    expect(d1).toBeCloseTo(0, 9);
    const d2 = vsc.delta(0, 600, 100 / (0.6 * 24) + 500 / (0.6 * 36));
    expect(d2).toBeCloseTo(0, 9);
  });

  it('EDGE8: non-finite lapDistance or time returns the last delta', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    const last = vsc.delta(0, 35, 1);
    expect(last).toBeCloseTo(-1 / 6, 12);
    expect(vsc.delta(0, Number.NaN, 2)).toBeCloseTo(-1 / 6, 12);
    expect(vsc.delta(0, 35, Number.NaN)).toBeCloseTo(-1 / 6, 12);
    expect(vsc.delta(0, Number.NaN, Number.NaN)).toBeCloseTo(-1 / 6, 12);
  });

  it('EDGE9: out-of-range car index throws RangeError', () => {
    const vsc = constantVsc(50, 1);
    expect(() => vsc.delta(1, 0, 0)).toThrow(RangeError);
    expect(() => vsc.delta(-1, 0, 0)).toThrow(RangeError);
    vsc.update(10, 0);
    expect(() => vsc.delta(1, 0, 0)).toThrow(RangeError);
  });

  it('EDGE10: no event at exactly 2 s of too-fast time; one event when it exceeds 2 s, also during ending', () => {
    const vsc = constantVsc(50);
    vsc.update(10, 0);
    vsc.delta(0, 0, 0);
    vsc.delta(0, 35, 1);
    vsc.delta(0, 70, 2);
    expect(vsc.drainEvents()).toHaveLength(0);
    vsc.update(0, 2.5);
    expect(vsc.phase).toBe('ending');
    vsc.delta(0, 105, 3);
    const events = vsc.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].car).toBe(0);
    expect(events[0].seconds).toBe(5);
    expect(vsc.drainEvents()).toHaveLength(0);
  });
});

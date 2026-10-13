import { describe, it, expect } from 'vitest';
import { RaceClassification } from '../../../src/race/classification';

const DT = 1 / 120;
const L = 1000;

function lapDistanceAt(start: number, speed: number, t: number): number {
  const d = (start + speed * t) % L;
  return d < 0 ? d + L : d;
}

function feed(c: RaceClassification, starts: number[], speeds: number[], from: number, to: number): void {
  for (let k = Math.round(from / DT); k <= Math.round(to / DT); k++) {
    const t = k * DT;
    for (let i = 0; i < speeds.length; i++) c.update(i, lapDistanceAt(starts[i], speeds[i], t), t);
  }
}

describe('RaceClassification', () => {
  it('standings reuses the same array and objects', () => {
    const c = new RaceClassification(2, 1, L);
    const a = c.standings();
    const b = c.standings();
    expect(a).toBe(b);
    expect(a[0]).toBe(b.find((s) => s.car === a[0].car));
  });

  it('throws RangeError for out-of-range cars', () => {
    const c = new RaceClassification(2, 1, L);
    expect(() => c.update(-1, 0, 0)).toThrow(RangeError);
    expect(() => c.update(2, 0, 0)).toThrow(RangeError);
    expect(() => c.addPenalty(2, 1)).toThrow(RangeError);
    expect(() => c.retire(-1)).toThrow(RangeError);
  });

  it('ignores non-finite inputs', () => {
    const c = new RaceClassification(1, 1, L);
    c.update(0, NaN, 1);
    c.update(0, Infinity, 2);
    c.update(0, 100, NaN);
    c.addPenalty(0, NaN);
    const s = c.standings()[0];
    expect(s.lap).toBe(0);
    expect(s.penalty).toBe(0);
    expect(s.gapToLeader).toBeNull();
  });

  it('race distance is negative before the first crossing and grows after', () => {
    const c = new RaceClassification(1, 3, L);
    c.update(0, 990, 0);
    expect(c.standings()[0].distance).toBe(-10);
    c.update(0, 0.4166666666666631, 0.2);
    expect(c.standings()[0].lap).toBe(1);
    expect(c.standings()[0].distance).toBeCloseTo(0.4166666666666631, 9);
  });

  it('standings order: finished by totalTime+penalty, then running by distance, then retired', () => {
    const c = new RaceClassification(4, 2, L);
    c.update(0, 100, 1);
    c.update(1, 200, 1);
    c.retire(2);
    c.update(3, 50, 1);
    expect(c.standings().map((x) => x.car)).toEqual([1, 0, 3, 2]);

    const f = new RaceClassification(3, 1, L);
    feed(f, [950, 0, 0], [100, 0, 0], 0, 11);
    const mid = f.standings();
    expect(mid[0].car).toBe(0);
    expect(mid[0].finished).toBe(true);
    expect(mid[1].car).toBe(1);
    f.retire(1);
    expect(f.finished).toBe(false);
    f.retire(2);
    expect(f.standings().map((x) => x.car)).toEqual([0, 1, 2]); // retire order: earlier retirement first
    expect(f.finished).toBe(true);
  });

  it('gapToLeader is 0 for the leader and interpolates the 50 m history', () => {
    const c = new RaceClassification(2, 3, L);
    feed(c, [990, 990], [50, 40], 0, 15);
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].gapToLeader).toBe(0);
    expect(s[1].gapToLeader).not.toBeNull();
    expect(Math.abs(s[1].gapToLeader! - 3.0)).toBeLessThanOrEqual(0.05);
  });

  it('updates after finish are ignored', () => {
    const c = new RaceClassification(1, 1, L);
    feed(c, [0], [100], 0, 21);
    expect(c.standings()[0].finished).toBe(true);
    expect(c.standings()[0].totalTime).toBeCloseTo(20, 6);
    c.update(0, 500, 99);
    expect(c.standings()[0].totalTime).toBeCloseTo(20, 6);
    expect(c.standings()[0].distance).toBeCloseTo(L, 6);
  });

  it('penalties accumulate and only affect ordering, not totalTime', () => {
    const c = new RaceClassification(1, 1, L);
    feed(c, [0], [100], 0, 21);
    c.addPenalty(0, 2);
    c.addPenalty(0, 3);
    expect(c.standings()[0].penalty).toBe(5);
    expect(c.standings()[0].totalTime).toBeCloseTo(20, 6);
  });

  it('a negative jump does not change the lap', () => {
    const c = new RaceClassification(1, 5, L);
    c.update(0, 990, 0);
    c.update(0, 100, 1);
    c.update(0, 50, 2);
    expect(c.standings()[0].lap).toBe(0);
  });
});

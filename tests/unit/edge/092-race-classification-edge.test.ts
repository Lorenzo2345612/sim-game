import { describe, it, expect } from 'vitest';
import { RaceClassification } from '../../../src/race/classification';

const L = 1000;

function lapDistanceAt(start: number, speed: number, t: number): number {
  const d = (start + speed * t) % L;
  return d < 0 ? d + L : d;
}

function feed(
  c: RaceClassification,
  starts: number[],
  speeds: number[],
  from: number,
  to: number,
): void {
  for (let k = Math.round(from * 120); k <= Math.round(to * 120); k++) {
    const t = k / 120;
    for (let i = 0; i < speeds.length; i++) {
      c.update(i, lapDistanceAt(starts[i], speeds[i], t), t);
    }
  }
}

describe('092 race classification edge cases', () => {
  it('EDGE1: out-of-range car throws RangeError in update, addPenalty and retire', () => {
    const c = new RaceClassification(2, 2, L);
    expect(() => c.update(2, 0, 0)).toThrow(RangeError);
    expect(() => c.update(-1, 0, 0)).toThrow(RangeError);
    expect(() => c.addPenalty(2, 1)).toThrow(RangeError);
    expect(() => c.addPenalty(-1, 1)).toThrow(RangeError);
    expect(() => c.retire(2)).toThrow(RangeError);
    expect(() => c.retire(-1)).toThrow(RangeError);
  });

  it('EDGE2: non-finite lapDistance or time is ignored', () => {
    const c = new RaceClassification(1, 2, L);
    c.update(0, 100, 0);
    expect(c.standings()[0].lap).toBe(0);
    expect(c.standings()[0].distance).toBeCloseTo(-900, 6);

    c.update(0, Number.NaN, 1);
    c.update(0, 500, 2);
    c.update(0, Number.POSITIVE_INFINITY, 3);
    c.update(0, 200, Number.NaN);
    c.update(0, 500, Number.NEGATIVE_INFINITY);

    const s = c.standings()[0];
    expect(s.lap).toBe(0);
    expect(s.distance).toBeCloseTo(-900, 6);
    expect(s.lastLap).toBeNull();
    expect(s.finished).toBe(false);
  });

  it('EDGE3: retired cars sort after running cars in retire order; finished when all finished or retired', () => {
    const c = new RaceClassification(3, 1, L);
    c.update(0, 990, 0);
    c.update(0, 10, 0.5);
    c.update(0, 500, 3);
    c.update(0, 940, 5.4);
    c.update(0, 10, 5.5);
    c.update(1, 300, 0);
    c.update(2, 500, 0);
    c.update(2, 600, 1);
    c.retire(1);

    let s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].position).toBe(1);
    expect(s[0].finished).toBe(true);
    expect(s[0].totalTime).toBeCloseTo(5.4 + (0.1 * 60) / 70, 6);
    expect(s[1].car).toBe(2);
    expect(s[1].position).toBe(2);
    expect(s[1].distance).toBeCloseTo(-400, 6);
    expect(s[2].car).toBe(1);
    expect(s[2].position).toBe(3);
    expect(c.finished).toBe(false);

    c.retire(2);
    s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[1].car).toBe(1);
    expect(s[2].car).toBe(2);
    expect(c.finished).toBe(true);
  });

  it('EDGE4: update after a car finished is ignored', () => {
    const c = new RaceClassification(1, 1, L);
    c.update(0, 990, 0);
    c.update(0, 10, 0.2);
    c.update(0, 500, 2.5);
    c.update(0, 990, 4.9);
    c.update(0, 20, 5.1);
    expect(c.finished).toBe(true);

    c.update(0, 500, 8);
    c.update(0, 990, 9);
    c.update(0, 30, 9.2);

    const s = c.standings()[0];
    expect(s.finished).toBe(true);
    expect(s.lap).toBe(2);
    expect(s.totalTime).toBeCloseTo(4.9 + (0.2 * 10) / 30, 6);
    expect(s.distance).toBeCloseTo(1020, 6);
    expect(s.lastLap).toBeCloseTo(4.9 + (0.2 * 10) / 30 - 0.1, 6);
  });

  it('EDGE5: re-cross without passing half a lap since the previous crossing does not complete a lap', () => {
    const c = new RaceClassification(1, 5, L);
    const samples: [number, number][] = [
      [0.0, 990],
      [0.1, 10],
      [0.2, 990],
      [0.3, 50],
    ];
    for (const [t, d] of samples) c.update(0, d, t);

    const s = c.standings()[0];
    expect(s.lap).toBe(1);
    expect(s.lastLap).toBeNull();
    expect(s.bestLap).toBeNull();
    expect(s.finished).toBe(false);
  });

  it('EDGE6: gapToLeader is 0 for the leader and null for a car that has not started a lap', () => {
    const c = new RaceClassification(2, 5, L);
    for (let k = 0; k <= 600; k++) {
      const t = k / 120;
      c.update(0, lapDistanceAt(990, 50, t), t);
      c.update(1, 500, t);
    }
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].gapToLeader).toBe(0);
    expect(s[1].car).toBe(1);
    expect(s[1].lap).toBe(0);
    expect(s[1].distance).toBeCloseTo(-500, 6);
    expect(s[1].gapToLeader).toBeNull();
  });

  it('EDGE7: standings reuses the same array and standing objects', () => {
    const c = new RaceClassification(2, 2, L);
    c.update(0, 500, 0);
    c.update(1, 400, 0);
    const first = c.standings();
    c.update(0, 510, 0.2);
    c.update(1, 410, 0.2);
    const second = c.standings();
    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it('EDGE8: lastLap is the latest lap and bestLap the minimum over unequal laps', () => {
    const c = new RaceClassification(1, 3, L);
    for (let k = 0; k <= Math.round(95 * 120); k++) {
      const t = k / 120;
      const travelled = t <= 5 ? 100 * t : t <= 17 ? 500 + 50 * (t - 5) : 1100 + 25 * (t - 17);
      c.update(0, (990 + travelled) % L, t);
    }
    const s = c.standings()[0];
    expect(s.finished).toBe(true);
    expect(s.lap).toBe(4);
    expect(s.lastLap).toBeCloseTo(40.0, 2);
    expect(s.bestLap).toBeCloseTo(15.1, 2);
    expect(s.totalTime).toBeCloseTo(93.4, 2);
    expect(s.distance).toBeGreaterThanOrEqual(3000);
    expect(s.distance).toBeLessThan(3001);
  });

  it('EDGE9: after the chequered flag the next crossing finishes the car and counts the lap', () => {
    const c = new RaceClassification(2, 3, L);
    feed(c, [990, 990], [100, 20], 0, 31);
    let s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].finished).toBe(true);
    expect(s[1].car).toBe(1);
    expect(s[1].finished).toBe(false);
    expect(c.finished).toBe(false);

    feed(c, [990, 990], [100, 20], 31 + 1 / 120, 51);
    s = c.standings();
    expect(s[1].finished).toBe(true);
    expect(s[1].lap).toBe(2);
    expect(s[1].totalTime).toBeCloseTo(50.5, 2);
    expect(s[1].lastLap).toBeCloseTo(50.0, 2);
    expect(c.finished).toBe(true);
  });

  it('EDGE10: penalty accumulates in Standing and does not reorder running cars', () => {
    const c = new RaceClassification(2, 5, L);
    c.update(0, 500, 0);
    c.update(1, 500, 0);
    c.update(0, 700, 1);
    c.update(1, 600, 1);
    c.addPenalty(0, 100);
    c.addPenalty(0, 5);

    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].position).toBe(1);
    expect(s[0].penalty).toBe(105);
    expect(s[1].car).toBe(1);
    expect(s[1].position).toBe(2);
    expect(s[1].penalty).toBe(0);
  });
});

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

describe('092 race classification post-code gaps', () => {
  it('GAP1: standings before any update expose the initial standing fields', () => {
    const c = new RaceClassification(2, 3, L);
    const s = c.standings();
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({
      car: 0,
      position: 1,
      lap: 0,
      distance: -L,
      finished: false,
      totalTime: null,
      penalty: 0,
      gapToLeader: null,
      lastLap: null,
      bestLap: null,
    });
    expect(s[1].car).toBe(1);
    expect(s[1].position).toBe(2);
  });

  it('GAP2: non-integer car index throws RangeError', () => {
    const c = new RaceClassification(2, 2, L);
    expect(() => c.update(0.5, 0, 0)).toThrow(RangeError);
    expect(() => c.update(Number.NaN, 0, 0)).toThrow(RangeError);
    expect(() => c.addPenalty(1.5, 1)).toThrow(RangeError);
    expect(() => c.retire(-0.5)).toThrow(RangeError);
  });

  it('GAP3: a sample sequence broken by NaN does not count the spanning crossing; the next real one does', () => {
    const c = new RaceClassification(1, 5, L);
    c.update(0, 990, 0);
    c.update(0, Number.NaN, 0.1);
    c.update(0, 10, 0.2);
    expect(c.standings()[0].lap).toBe(0);

    c.update(0, 950, 1);
    c.update(0, 5, 2);
    const s = c.standings()[0];
    expect(s.lap).toBe(1);
    expect(s.lastLap).toBeNull();
    expect(s.distance).toBeCloseTo(5, 6);
  });

  it('GAP4: updates for a retired car are ignored and double retire is a no-op', () => {
    const c = new RaceClassification(2, 2, L);
    c.update(0, 100, 0);
    c.update(0, 200, 1);
    c.retire(0);
    c.update(0, 990, 2);
    c.update(0, 50, 3);
    const s = c.standings().find((x) => x.car === 0)!;
    expect(s.position).toBe(2);
    expect(s.lap).toBe(0);
    expect(s.distance).toBeCloseTo(-800, 6);
    expect(s.finished).toBe(false);

    c.retire(0);
    c.retire(1);
    expect(c.standings().map((x) => x.car)).toEqual([0, 1]);
    expect(c.finished).toBe(true);
  });

  it('GAP5: order ties are broken by lower car index while running and when finished', () => {
    const c = new RaceClassification(2, 3, L);
    c.update(0, 500, 0);
    c.update(1, 500, 0);
    expect(c.standings().map((x) => x.car)).toEqual([0, 1]);

    c.update(1, 520, 0.5);
    expect(c.standings().map((x) => x.car)).toEqual([1, 0]);

    const f = new RaceClassification(2, 1, L);
    feed(f, [950, 950], [100, 100], 0, 11);
    const s = f.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].totalTime).toBeCloseTo(10.5, 6);
    expect(s[1].car).toBe(1);
    expect(s[1].totalTime).toBeCloseTo(10.5, 6);
  });

  it('GAP6: crossing detection uses strict 0.9L/0.1L bounds', () => {
    const c = new RaceClassification(1, 5, L);
    c.update(0, 900, 0);
    c.update(0, 50, 1);
    expect(c.standings()[0].lap).toBe(0);

    c.update(0, 950, 2);
    c.update(0, 100, 3);
    expect(c.standings()[0].lap).toBe(0);

    c.update(0, 990, 4);
    c.update(0, 10, 5);
    expect(c.standings()[0].lap).toBe(1);
  });

  it('GAP7: gapToLeader is null below the leader first 50 m history mark', () => {
    const c = new RaceClassification(2, 5, L);
    for (let k = 0; k <= 180; k++) {
      const t = k / 120;
      c.update(0, lapDistanceAt(990, 50, t), t);
      c.update(1, lapDistanceAt(990, 20, t), t);
    }
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].distance).toBeCloseTo(65, 6);
    expect(s[0].gapToLeader).toBe(0);
    expect(s[1].car).toBe(1);
    expect(s[1].lap).toBe(1);
    expect(s[1].distance).toBeCloseTo(20, 6);
    expect(s[1].gapToLeader).toBeNull();
  });

  it('GAP8: gapToLeader is null when the follower sits above the leader last history mark', () => {
    const c = new RaceClassification(2, 5, L);
    c.update(0, 990, 0);
    c.update(1, 990, 0);
    c.update(0, 5, 0.2);
    c.update(1, 5, 0.3);
    c.update(0, 110, 2);
    c.update(1, 103, 2);
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].gapToLeader).toBe(0);
    expect(s[1].car).toBe(1);
    expect(s[1].gapToLeader).toBeNull();
  });

  it('GAP9: gapToLeader holds with coarse 1 s samples', () => {
    const c = new RaceClassification(2, 2, L);
    for (let t = 0; t <= 15; t++) {
      c.update(0, lapDistanceAt(990, 50, t), t);
      c.update(1, lapDistanceAt(990, 40, t), t);
    }
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].gapToLeader).toBe(0);
    expect(s[1].car).toBe(1);
    expect(s[1].gapToLeader).not.toBeNull();
    expect(Math.abs(s[1].gapToLeader! - 3.0)).toBeLessThanOrEqual(0.05);
  });

  it('GAP10: zero-car race is finished with empty standings', () => {
    const c = new RaceClassification(0, 2, L);
    expect(c.finished).toBe(true);
    expect(c.standings()).toEqual([]);
  });

  it('GAP11: after the chequered flag a car still on lap 0 finishes at its first crossing', () => {
    const c = new RaceClassification(2, 2, L);
    feed(c, [990, 500], [100, 10], 0, 51);
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].finished).toBe(true);
    expect(s[0].totalTime).toBeCloseTo(20.1, 2);
    expect(s[1].car).toBe(1);
    expect(s[1].finished).toBe(true);
    expect(s[1].lap).toBe(1);
    expect(s[1].totalTime).toBeCloseTo(50, 2);
    expect(c.finished).toBe(true);
  });

  it('GAP12: negative penalty accumulates as a time credit and reorders finished cars', () => {
    const c = new RaceClassification(2, 1, L);
    feed(c, [950, 900], [100, 100], 0, 11);
    c.addPenalty(1, -1);
    c.addPenalty(0, 0);
    const s = c.standings();
    expect(s[0].car).toBe(1);
    expect(s[1].car).toBe(0);
    expect(s[1].penalty).toBe(0);
  });
});

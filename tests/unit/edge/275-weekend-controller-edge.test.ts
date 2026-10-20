import { describe, expect, it } from 'vitest';
import type { PointsTable, WeekendFormat } from '../../../src/career/types';
import type { SessionResult } from '../../../src/career/weekend';
import { Weekend } from '../../../src/career/weekend';

const tables: Record<string, PointsTable> = {
  standard10: {
    id: 'standard10',
    positions: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    fastestLap: { points: 1, maxPosition: 10 },
  },
  sprint: { id: 'sprint', positions: [8, 7, 6, 5] },
  flat: { id: 'flat', positions: [10, 10, 10, 10] },
};

function result(
  order: number[],
  bestLaps: (number | null)[],
  classified?: boolean[],
  fastestLapCar: number | null = null,
): SessionResult {
  return {
    order,
    bestLaps,
    classified: classified ?? Array.from({ length: order.length }, () => true),
    fastestLapCar,
  };
}

function naturalResult(n: number): SessionResult {
  return result(
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, () => null),
  );
}

const sprintFormat: WeekendFormat = {
  id: 'sprint',
  name: 'Sprint',
  sessions: [
    { kind: 'practice', minutes: 30 },
    { kind: 'qualifying', minutes: 20, polePoints: 2 },
    { kind: 'sprint', laps: 15, points: 'sprint', grid: 'reverse-top8' },
    { kind: 'race', laps: 50, points: 'standard10', grid: 'qualifying' },
  ],
};

const standardFormat: WeekendFormat = {
  id: 'standard',
  name: 'Standard',
  sessions: [
    { kind: 'practice', minutes: 30 },
    { kind: 'qualifying', minutes: 20 },
    { kind: 'race', laps: 50, points: 'standard10', grid: 'qualifying' },
  ],
};

const reverseFormat: WeekendFormat = {
  id: 'reverse',
  name: 'Reverse',
  sessions: [
    { kind: 'practice', minutes: 30 },
    { kind: 'qualifying', minutes: 20 },
    { kind: 'sprint', laps: 10, points: 'sprint', grid: 'reverse-top8' },
  ],
};

describe('Weekend controller edge cases', () => {
  it('EDGE1: result(i) returns the submitted session result and undefined before it', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(w.result(0)).toBeUndefined();
    expect(w.result(3)).toBeUndefined();
    const practice = naturalResult(4);
    w.submit(practice);
    expect(w.result(0)).toEqual(practice);
    expect(w.result(1)).toBeUndefined();
  });

  it('EDGE2: pole points need a timed P1 car and ignore classification', () => {
    const w1 = new Weekend(sprintFormat, 4, tables);
    w1.submit(naturalResult(4));
    expect(w1.submit(result([2, 1, 0, 3], [90.0, 91.0, null, 92.0]))).toEqual([0, 0, 0, 0]);
    expect(w1.totals()).toEqual([0, 0, 0, 0]);

    const w2 = new Weekend(sprintFormat, 4, tables);
    w2.submit(naturalResult(4));
    expect(w2.submit(result([1, 0, 2, 3], [89.5, 90.0, 91.0, 92.0], [false, true, true, true]))).toEqual([
      0, 2, 0, 0,
    ]);
    expect(w2.totals()).toEqual([0, 2, 0, 0]);
  });

  it('EDGE3: reverse-top8 reverses only the first eight timed cars', () => {
    const w = new Weekend(reverseFormat, 10, tables);
    w.submit(naturalResult(10));
    w.submit(result([9, 8, 7, 6, 5, 4, 3, 2, 1, 0], Array.from({ length: 10 }, () => 80)));
    expect(w.gridFor()).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 1, 0]);
  });

  it('EDGE4: reverse-top8 keeps remaining cars in the qualifying grid order', () => {
    const w = new Weekend(reverseFormat, 6, tables);
    w.submit(naturalResult(6));
    w.submit(result([5, 4, 3, 2, 1, 0], [90, 91, 92, null, 93, null]));
    expect(w.gridFor()).toEqual([0, 1, 2, 4, 3, 5]);
  });

  it('EDGE5: submit throws when order or classified has the wrong length', () => {
    const w1 = new Weekend(sprintFormat, 4, tables);
    expect(() => w1.submit({ ...naturalResult(4), order: [0, 1, 2] })).toThrow();
    const w2 = new Weekend(sprintFormat, 4, tables);
    expect(() => w2.submit({ ...naturalResult(4), classified: [true, true, true] })).toThrow();
  });

  it('EDGE6: sprint-result grid comes from the last sprint', () => {
    const format: WeekendFormat = {
      id: 'two-sprints',
      name: 'Two sprints',
      sessions: [
        { kind: 'sprint', laps: 10, points: 'sprint', grid: 'qualifying' },
        { kind: 'sprint', laps: 10, points: 'sprint', grid: 'qualifying' },
        { kind: 'race', laps: 20, points: 'standard10', grid: 'sprint-result' },
      ],
    };
    const w = new Weekend(format, 4, tables);
    w.submit(result([3, 1, 0, 2], [null, null, null, null]));
    w.submit(result([2, 0, 3, 1], [null, null, null, null]));
    expect(w.gridFor()).toEqual([2, 0, 3, 1]);
  });

  it('EDGE7: qualifying grid places untimed cars after timed ones by car index', () => {
    const w = new Weekend(standardFormat, 4, tables);
    w.submit(naturalResult(4));
    w.submit(result([2, 1, 0, 3], [null, 90.5, null, 91.0]));
    expect(w.gridFor()).toEqual([1, 3, 0, 2]);
  });

  it('EDGE8: standings compare sorted points-session positions lexicographically, then car index', () => {
    const format: WeekendFormat = {
      id: 'flat',
      name: 'Flat',
      sessions: [
        { kind: 'sprint', laps: 10, points: 'flat', grid: 'qualifying' },
        { kind: 'race', laps: 20, points: 'flat', grid: 'qualifying' },
      ],
    };
    const w = new Weekend(format, 4, tables);
    w.submit(result([0, 2, 1, 3], [null, null, null, null]));
    w.submit(result([1, 3, 2, 0], [null, null, null, null]));
    expect(w.totals()).toEqual([20, 20, 20, 20]);
    expect(w.standings()).toEqual([1, 0, 2, 3]);
  });

  it('EDGE9: submit keeps a copy of the result and returns an independent array', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    const practice: SessionResult = {
      order: [3, 2, 1, 0],
      bestLaps: [95.0, 94.0, 93.0, 92.0],
      classified: [true, true, true, true],
      fastestLapCar: 1,
    };
    const pts = w.submit(practice);
    expect(w.result(0)).toEqual(practice);
    expect(practice.order).toEqual([3, 2, 1, 0]);
    practice.order[0] = 0;
    practice.bestLaps[0] = 0;
    expect(w.result(0)?.order).toEqual([3, 2, 1, 0]);
    expect(w.result(0)?.bestLaps).toEqual([95.0, 94.0, 93.0, 92.0]);
    pts[0] = 99;
    expect(w.totals()).toEqual([0, 0, 0, 0]);
  });

  it('EDGE10: race grid follows the last qualifying session', () => {
    const format: WeekendFormat = {
      id: 'two-quali',
      name: 'Two qualifying',
      sessions: [
        { kind: 'qualifying', minutes: 20 },
        { kind: 'qualifying', minutes: 20 },
        { kind: 'race', laps: 30, points: 'standard10', grid: 'qualifying' },
      ],
    };
    const w = new Weekend(format, 4, tables);
    w.submit(result([1, 0, 3, 2], [91.0, 90.0, 93.0, 92.0]));
    w.submit(result([3, 1, 2, 0], [89.0, 90.5, 91.5, 92.5]));
    expect(w.gridFor()).toEqual([3, 1, 2, 0]);
  });
});

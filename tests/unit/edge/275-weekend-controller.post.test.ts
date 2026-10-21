import { readFileSync } from 'node:fs';
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

describe('Weekend controller post-code gaps', () => {
  it('P1: gridFor returns [] when done and index equals the session count', () => {
    const format: WeekendFormat = {
      id: 'race-only',
      name: 'Race only',
      sessions: [{ kind: 'race', laps: 3, points: 'sprint', grid: 'qualifying' }],
    };
    const w = new Weekend(format, 3, tables);
    w.submit(naturalResult(3));
    expect(w.done).toBe(true);
    expect(w.index).toBe(1);
    expect(w.gridFor()).toEqual([]);
  });

  it('P2: empty session list starts done with no current session', () => {
    const w = new Weekend({ id: 'empty', name: 'Empty', sessions: [] }, 2, tables);
    expect(w.done).toBe(true);
    expect(w.index).toBe(0);
    expect(w.current).toBeNull();
    expect(w.gridFor()).toEqual([]);
    expect(() => w.submit(naturalResult(2))).toThrow();
  });

  it('P3: constructor throws on negative or fractional carCount', () => {
    expect(() => new Weekend(sprintFormat, -1, tables)).toThrow();
    expect(() => new Weekend(sprintFormat, 2.5, tables)).toThrow();
  });

  it('P4: submit throws on order values outside 0..n-1', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(() => w.submit(result([0, 1, 2, 4], [null, null, null, null]))).toThrow();
    expect(() => w.submit(result([0, 1, 2, -1], [null, null, null, null]))).toThrow();
    expect(w.index).toBe(0);
  });

  it('P5: submit throws on non-finite bestLaps entries', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(() => w.submit(result([0, 1, 2, 3], [NaN, null, null, null]))).toThrow();
    expect(() => w.submit(result([0, 1, 2, 3], [null, null, Infinity, null]))).toThrow();
    expect(w.index).toBe(0);
  });

  it('P6: submit throws on non-boolean classified and invalid fastestLapCar', () => {
    const w1 = new Weekend(sprintFormat, 4, tables);
    expect(() =>
      w1.submit({ order: [0, 1, 2, 3], bestLaps: [null, null, null, null], classified: [true, true, true, 1 as unknown as boolean], fastestLapCar: null }),
    ).toThrow();
    const w2 = new Weekend(sprintFormat, 4, tables);
    expect(() => w2.submit(result([0, 1, 2, 3], [null, null, null, null], undefined, 4))).toThrow();
    const w3 = new Weekend(sprintFormat, 4, tables);
    expect(() => w3.submit(result([0, 1, 2, 3], [null, null, null, null], undefined, 0.5))).toThrow();
    expect(w2.index).toBe(0);
  });

  it('P7: submit throws when the points table name is unknown', () => {
    const format: WeekendFormat = {
      id: 'missing-table',
      name: 'Missing table',
      sessions: [{ kind: 'race', laps: 3, points: 'ghost', grid: 'qualifying' }],
    };
    const w = new Weekend(format, 3, tables);
    expect(() => w.submit(naturalResult(3))).toThrow();
    expect(w.done).toBe(false);
  });

  it('P8: qualifying without polePoints scores zero even with a timed leader', () => {
    const format: WeekendFormat = {
      id: 'no-pole',
      name: 'No pole',
      sessions: [
        { kind: 'qualifying', minutes: 20 },
        { kind: 'race', laps: 10, points: 'sprint', grid: 'qualifying' },
      ],
    };
    const w = new Weekend(format, 4, tables);
    expect(w.submit(result([2, 0, 1, 3], [90.0, 91.0, 89.5, 92.0]))).toEqual([0, 0, 0, 0]);
    expect(w.totals()).toEqual([0, 0, 0, 0]);
  });

  it('P9: qualifying awards polePoints only and ignores fastestLapCar', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    w.submit(naturalResult(4));
    const pts = w.submit(result([1, 0, 2, 3], [89.5, 90.0, 91.0, 92.0], undefined, 2));
    expect(pts).toEqual([0, 2, 0, 0]);
  });

  it('P10: a second qualifying session starts on the natural grid', () => {
    const format: WeekendFormat = {
      id: 'two-quali',
      name: 'Two qualifying',
      sessions: [
        { kind: 'qualifying', minutes: 20 },
        { kind: 'qualifying', minutes: 20 },
        { kind: 'race', laps: 30, points: 'sprint', grid: 'qualifying' },
      ],
    };
    const w = new Weekend(format, 4, tables);
    w.submit(result([3, 1, 0, 2], [93.0, 91.0, 92.0, 90.5]));
    expect(w.gridFor()).toEqual([0, 1, 2, 3]);
  });

  it('P11: reverse-top8 without any qualifying falls back to the natural grid', () => {
    const format: WeekendFormat = {
      id: 'sprint-only',
      name: 'Sprint only',
      sessions: [{ kind: 'sprint', laps: 10, points: 'sprint', grid: 'reverse-top8' }],
    };
    const w = new Weekend(format, 6, tables);
    expect(w.gridFor()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('P12: standings on a fresh weekend are car-index order', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(w.standings()).toEqual([0, 1, 2, 3]);
    w.submit(naturalResult(4));
    expect(w.standings()).toEqual([0, 1, 2, 3]);
  });

  it('P13: standings tie-break falls to car index when position lists are equal', () => {
    const format: WeekendFormat = {
      id: 'mirror',
      name: 'Mirror',
      sessions: [
        { kind: 'sprint', laps: 10, points: 'flat', grid: 'qualifying' },
        { kind: 'race', laps: 20, points: 'flat', grid: 'qualifying' },
      ],
    };
    const w = new Weekend(format, 2, tables);
    w.submit(result([0, 1], [null, null]));
    w.submit(result([1, 0], [null, null]));
    expect(w.totals()).toEqual([20, 20]);
    expect(w.standings()).toEqual([0, 1]);
  });

  it('P14: cars beyond the points table length score zero', () => {
    const format: WeekendFormat = {
      id: 'wide',
      name: 'Wide',
      sessions: [{ kind: 'race', laps: 10, points: 'sprint', grid: 'qualifying' }],
    };
    const w = new Weekend(format, 6, tables);
    expect(w.submit(naturalResult(6))).toEqual([8, 7, 6, 5, 0, 0]);
  });

  it('P15: totals() and gridFor() return independent copies', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    const grid = w.gridFor();
    grid[0] = 99;
    expect(w.gridFor()).toEqual([0, 1, 2, 3]);
    w.submit(naturalResult(4));
    const totals = w.totals();
    totals[0] = 99;
    expect(w.totals()).toEqual([0, 0, 0, 0]);
  });

  it('P16: result(i) is undefined out of range and a zero-car weekend works', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(w.result(-1)).toBeUndefined();
    expect(w.result(99)).toBeUndefined();
    const zero = new Weekend(
      { id: 'zero', name: 'Zero', sessions: [{ kind: 'race', laps: 1, points: 'sprint', grid: 'qualifying' }] },
      0,
      tables,
    );
    expect(zero.gridFor()).toEqual([]);
    expect(zero.submit(naturalResult(0))).toEqual([]);
    expect(zero.done).toBe(true);
    expect(zero.standings()).toEqual([]);
  });

  it('P17: weekend module does not import three', () => {
    const src = readFileSync(new URL('../../../src/career/weekend.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three['"]/);
    expect(src).not.toMatch(/require\(['"]three['"]\)/);
  });
});

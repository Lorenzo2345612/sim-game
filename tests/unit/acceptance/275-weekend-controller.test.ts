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
};

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

const raceOnlyFormat: WeekendFormat = {
  id: 'race-only',
  name: 'Race only',
  sessions: [{ kind: 'race', laps: 3, points: 'standard10', grid: 'qualifying' }],
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

function identityResult(n: number): SessionResult {
  return {
    order: Array.from({ length: n }, (_, i) => i),
    bestLaps: Array.from({ length: n }, () => null),
    classified: Array.from({ length: n }, () => true),
    fastestLapCar: null,
  };
}

function qualifyingResult(): SessionResult {
  return {
    order: [1, 3, 0, 2],
    bestLaps: [92.0, 90.5, null, 91.0],
    classified: [true, true, true, true],
    fastestLapCar: null,
  };
}

function sprintResult(): SessionResult {
  return {
    order: [3, 0, 1, 2],
    bestLaps: [null, null, null, null],
    classified: [true, true, true, true],
    fastestLapCar: 0,
  };
}

function raceResult(fastestLapCar: number): SessionResult {
  return {
    order: [1, 0, 3, 2],
    bestLaps: [null, null, null, null],
    classified: [true, true, false, true],
    fastestLapCar,
  };
}

function setupToSprint(): Weekend {
  const w = new Weekend(sprintFormat, 4, tables);
  w.submit(identityResult(4));
  w.submit(qualifyingResult());
  w.submit(sprintResult());
  return w;
}

describe('Weekend controller acceptance', () => {
  it('AT1: new sprint weekend starts at practice with natural grid', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    expect(w.index).toBe(0);
    expect(w.current?.kind).toBe('practice');
    expect(w.gridFor()).toEqual([0, 1, 2, 3]);
  });

  it('AT2: qualifying with pole points scores pole and advances index', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    w.submit(identityResult(4));
    const pts = w.submit(qualifyingResult());
    expect(pts).toEqual([0, 2, 0, 0]);
    expect(w.totals()).toEqual([0, 2, 0, 0]);
    expect(w.index).toBe(2);
  });

  it('AT3: reverse-top8 sprint grid from qualifying order', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    w.submit(identityResult(4));
    w.submit(qualifyingResult());
    expect(w.gridFor()).toEqual([0, 3, 1, 2]);
  });

  it('AT4: sprint points, totals and standings tie-break by finishing positions', () => {
    const w = new Weekend(sprintFormat, 4, tables);
    w.submit(identityResult(4));
    w.submit(qualifyingResult());
    expect(w.submit(sprintResult())).toEqual([7, 6, 5, 8]);
    expect(w.totals()).toEqual([7, 8, 5, 8]);
    expect(w.standings()).toEqual([3, 1, 0, 2]);
  });

  it('AT5: race grid follows last qualifying order', () => {
    expect(setupToSprint().gridFor()).toEqual([1, 3, 0, 2]);
  });

  it('AT6: race points, totals, standings and completion', () => {
    const w = setupToSprint();
    expect(w.submit(raceResult(2))).toEqual([18, 25, 0, 15]);
    expect(w.totals()).toEqual([25, 33, 5, 23]);
    expect(w.standings()).toEqual([1, 0, 3, 2]);
    expect(w.done).toBe(true);
    expect(w.current).toBeNull();
  });

  it('AT7: fastest lap bonus applies to classified car in top positions', () => {
    const w = setupToSprint();
    expect(w.submit(raceResult(0))[0]).toBe(19);
    expect(w.totals()[0]).toBe(26);
  });

  it('AT8: submit throws when done, on duplicate order or wrong-length arrays', () => {
    const done = setupToSprint();
    done.submit(raceResult(2));
    expect(() => done.submit(identityResult(4))).toThrow();

    const w1 = new Weekend(sprintFormat, 4, tables);
    expect(() => w1.submit({ ...identityResult(4), order: [0, 0, 1, 2] })).toThrow();

    const w2 = new Weekend(sprintFormat, 4, tables);
    expect(() => w2.submit({ ...identityResult(4), bestLaps: [null, null, null] })).toThrow();
  });

  it('AT9: single race session with no qualifying starts on natural grid', () => {
    const w = new Weekend(raceOnlyFormat, 3, tables);
    expect(w.gridFor()).toEqual([0, 1, 2]);
  });

  it('AT10: all-untimed qualifying falls back to car-index order for race grid', () => {
    const w = new Weekend(standardFormat, 3, tables);
    w.submit(identityResult(3));
    w.submit({
      order: [2, 1, 0],
      bestLaps: [null, null, null],
      classified: [true, true, true],
      fastestLapCar: null,
    });
    expect(w.gridFor()).toEqual([0, 1, 2]);
  });

  it('AT11: sprint-result grid without an earlier sprint session throws', () => {
    const format: WeekendFormat = {
      id: 'bad',
      name: 'Bad',
      sessions: [{ kind: 'race', laps: 3, points: 'standard10', grid: 'sprint-result' }],
    };
    expect(() => new Weekend(format, 3, tables)).toThrow();
  });
});

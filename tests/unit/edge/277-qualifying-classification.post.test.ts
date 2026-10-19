import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { QualifyingClassification, type QualiStanding } from '../../../src/race/qualifying';

const DT = 0.05;
const TICKS = 20;
const L = 1000;
const DUR = 600;

type Key = [number, number];

function distAt(keys: Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [ta, da] = keys[i - 1];
      const [tb, db] = keys[i];
      return da + ((db - da) * (t - ta)) / (tb - ta);
    }
  }
  return keys[keys.length - 1][1];
}

function forward(crossings: number[]): Key[] {
  const keys: Key[] = [[0, 990]];
  for (const c of crossings) {
    keys.push([c - DT, 990]);
    keys.push([c, 5]);
  }
  return keys;
}

function feed(
  q: QualifyingClassification,
  car: number,
  keys: Key[],
  to?: number,
  off?: (tick: number) => number,
): void {
  const end = Math.round((to ?? keys[keys.length - 1][0]) * TICKS);
  for (let k = 0; k <= end; k++) {
    const t = k / TICKS;
    q.update(car, distAt(keys, t), t, off ? off(k) : 0, DT);
  }
}

function standing(q: QualifyingClassification, car: number): QualiStanding {
  const s = q.standings().find((x: QualiStanding) => x.car === car);
  if (!s) throw new Error(`car ${car} missing`);
  return s;
}

function close(actual: number | null, expected: number, tol: number, label: string): void {
  expect(actual, `${label}: got ${actual}`).not.toBeNull();
  if (actual === null) return;
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(tol);
}

describe('277 qualifying classification post-code gaps', () => {
  it('POST1: non-integer and NaN car indices are ignored', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]));
    q.update(0.5, 5, 100, 4, DT);
    q.update(Number.NaN, 5, 100, 4, DT);
    q.retire(1.5);
    const s0 = standing(q, 0);
    expect(s0.laps).toBe(1);
    expect(s0.done).toBe(false);
    expect(standing(q, 1).done).toBe(false);
    expect(q.standings().length).toBe(2);
  });

  it('POST2: rise of exactly lapLength/2 is not a backward crossing and does not void the lap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    const keys: Key[] = [
      [0, 990],
      [0.95, 990],
      [1, 5],
      [29.95, 5],
      [30, 505],
      [60.95, 990],
      [61, 5],
    ];
    feed(q, 0, keys);
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.lastLap, 60, 1e-6, 'car0 lastLap');
    expect(s.lastValid).toBe(true);
  });

  it('POST3: continuous 4-off on the out-lap does not invalidate the first timed lap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, (k) => (k < 20 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.bestLap, 60, 1e-6, 'car0 bestLap');
    expect(s.lastValid).toBe(true);
  });

  it('POST4: wheelsOff below 4 for the whole lap keeps it valid', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, () => 3);
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    expect(s.lastValid).toBe(true);
    close(s.bestLap, 60, 1e-6, 'car0 bestLap');
  });

  it('POST5: wheelsOff above 4 still counts as off-track and invalidates', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, (k) => (k >= 600 && k < 606 ? 5 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    expect(s.lastValid).toBe(false);
    expect(s.bestLap).toBeNull();
  });

  it('POST6: 4-off spell ending on the crossing update itself invalidates the completing lap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, (k) => (k >= 1216 && k <= 1220 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.lastLap, 60, 1e-6, 'car0 lastLap');
    expect(s.lastValid).toBe(false);
    expect(s.bestLap).toBeNull();
  });

  it('POST7: validity restarts after a backward void — next lap is valid and sets bestLap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    const keys: Key[] = [
      [0, 990],
      [0.95, 990],
      [1, 5],
      [14.95, 5],
      [15, 995],
      [69.95, 995],
      [70, 5],
      [129.95, 990],
      [130, 5],
    ];
    feed(q, 0, keys, undefined, (k) => (k >= 100 && k < 106 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.bestLap, 60, 1e-6, 'car0 bestLap');
    expect(s.lastValid).toBe(true);
  });

  it('POST8: improving the best lap moves the tie-break time to the later set', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 66, 126]));
    feed(q, 1, forward([2, 62]));
    close(standing(q, 0).bestLap, 60, 1e-6, 'car0 bestLap');
    close(standing(q, 1).bestLap, 60, 1e-6, 'car1 bestLap');
    const s = q.standings();
    expect(s[0].car).toBe(1);
    expect(s[1].car).toBe(0);
  });

  it('POST9: identical bestLap and set time order by car index', () => {
    const q = new QualifyingClassification(3, L, DUR);
    feed(q, 2, forward([1, 61]));
    feed(q, 0, forward([1, 61]));
    feed(q, 1, forward([1, 61]));
    const s = q.standings();
    expect(s.map((x: QualiStanding) => x.car)).toEqual([0, 1, 2]);
    expect(s.map((x: QualiStanding) => x.position)).toEqual([1, 2, 3]);
  });

  it('POST10: a later invalid lap counts in laps but keeps the previous bestLap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61, 119]), undefined, (k) => (k >= 1400 && k < 1406 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(2);
    close(s.bestLap, 60, 1e-6, 'car0 bestLap');
    close(s.lastLap, 58, 1e-6, 'car0 lastLap');
    expect(s.lastValid).toBe(false);
  });

  it('POST11: zero cars — finished immediately, standings empty', () => {
    const q = new QualifyingClassification(0, L, DUR);
    expect(q.finished).toBe(true);
    expect(q.standings()).toEqual([]);
    expect(() => {
      q.update(0, 5, 1000, 4, DT);
      q.retire(0);
    }).not.toThrow();
  });

  it('POST12: a single large-dt 4-off update invalidates the in-progress lap', () => {
    const q = new QualifyingClassification(1, L, DUR);
    q.update(0, 990, 0, 0, DT);
    q.update(0, 5, 1, 0, DT);
    q.update(0, 500, 10, 4, 10);
    q.update(0, 990, 60.95, 0, DT);
    q.update(0, 5, 61, 0, DT);
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.lastLap, 60, 1e-6, 'car0 lastLap');
    expect(s.lastValid).toBe(false);
    expect(s.bestLap).toBeNull();
  });

  it('POST13: qualifying.ts imports neither three nor touches the DOM', () => {
    const src = readFileSync('src/race/qualifying.ts', 'utf8');
    expect(src).not.toMatch(/from\s+['"]three/);
    expect(src).not.toMatch(/['"]three\//);
    expect(src).not.toMatch(/\bdocument\b|\bwindow\b/);
  });

  it('POST14: grace endSession runs only on updates with a valid car index', () => {
    const q = new QualifyingClassification(1, L, DUR);
    q.update(0, 990, 0, 0, DT);
    q.update(1, 5, 900, 0, DT);
    expect(q.finished).toBe(false);
    expect(standing(q, 0).done).toBe(false);
    q.update(0, 990, 900, 0, DT);
    expect(q.finished).toBe(true);
    expect(standing(q, 0).done).toBe(true);
  });
});

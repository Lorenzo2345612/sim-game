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

describe('277 qualifying classification acceptance', () => {
  it('AT1: crossings at t=1 (990→5) and t=61 — car 0 laps 1, bestLap 60, lastValid true; car 1 bestLap null', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]));
    const s0 = standing(q, 0);
    expect(s0.laps).toBe(1);
    close(s0.bestLap, 60, 1e-6, 'car0 bestLap');
    expect(s0.lastValid).toBe(true);
    expect(standing(q, 1).bestLap).toBeNull();
  });

  it('AT2: 4 wheels off 0.30 s continuous — laps 1, bestLap null, lastValid false', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, (k) => (k >= 600 && k < 606 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    expect(s.bestLap).toBeNull();
    expect(s.lastValid).toBe(false);
  });

  it('AT3: two 0.20 s 4-off spells separated by on-track — lap valid', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(
      q,
      0,
      forward([1, 61]),
      undefined,
      (k) => ((k >= 600 && k < 604) || (k >= 800 && k < 804) ? 4 : 0),
    );
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    expect(s.lastValid).toBe(true);
  });

  it('AT4: car 0 invalid lap then 58 s valid; car 1 60 then 62 valid — bests 58 and 60', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61, 119]), undefined, (k) => (k >= 200 && k < 206 ? 4 : 0));
    feed(q, 1, forward([1, 61, 123]));
    close(standing(q, 0).bestLap, 58, 1e-6, 'car0 bestLap');
    close(standing(q, 1).bestLap, 60, 1e-6, 'car1 bestLap');
  });

  function lateSession(q: QualifyingClassification): void {
    feed(q, 0, forward([545, 605]));
    feed(q, 1, [[0, 990]], 10);
  }

  it('AT5: lap started at 545, crossing at 605 — lap counted 60 s, car 0 done, finished false', () => {
    const q = new QualifyingClassification(2, L, DUR);
    lateSession(q);
    const s0 = standing(q, 0);
    expect(s0.laps).toBe(1);
    close(s0.lastLap, 60, 1e-6, 'car0 lastLap');
    expect(s0.done).toBe(true);
    expect(q.finished).toBe(false);
  });

  it('AT6: retire car 1 after AT5 — finished true', () => {
    const q = new QualifyingClassification(2, L, DUR);
    lateSession(q);
    q.retire(1);
    expect(q.finished).toBe(true);
  });

  it('AT7: car never crosses, update at t=900.0 — finished true, car done, bestLap null', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 1, [[0, 990]], 900);
    expect(q.finished).toBe(true);
    const s = standing(q, 1);
    expect(s.done).toBe(true);
    expect(s.bestLap).toBeNull();
  });

  it('AT8: backward crossing at 30 voids lap; forward at 70 restarts, at 130 completes — laps 1, lastLap 60', () => {
    const q = new QualifyingClassification(2, L, DUR);
    const keys: Key[] = [
      [0, 990],
      [0.95, 990],
      [1, 5],
      [29.95, 5],
      [30, 995],
      [69.95, 995],
      [70, 5],
      [129.95, 990],
      [130, 5],
    ];
    feed(q, 0, keys);
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.lastLap, 60, 1e-6, 'car0 lastLap');
  });

  it('AT9: both cars best 60.0, car 1 set it earlier — car 1 position 1, car 0 position 2', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 1, forward([1, 61]));
    feed(q, 0, forward([10, 70]));
    const s = q.standings();
    close(s[0].bestLap, 60, 1e-6, 'first bestLap');
    close(s[1].bestLap, 60, 1e-6, 'second bestLap');
    expect(s[0].car).toBe(1);
    expect(s[0].position).toBe(1);
    expect(s[1].car).toBe(0);
    expect(s[1].position).toBe(2);
  });
});

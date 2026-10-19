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

describe('277 qualifying classification edge', () => {
  it('EDGE1: lapDistance drop of exactly lapLength/2 is not a forward crossing', () => {
    const q = new QualifyingClassification(2, L, DUR);
    q.update(0, 990, 0, 0, DT);
    q.update(0, 490, 1, 0, DT);
    for (let i = 1; i <= 40; i++) q.update(0, 490 + i * 12.5, 1 + i * DT, 0, DT);
    q.update(0, 5, 61, 0, DT);
    const s = standing(q, 0);
    expect(s.laps).toBe(0);
    expect(s.lastLap).toBeNull();
    expect(s.bestLap).toBeNull();
  });

  it('EDGE2: exactly OFF_LIMIT_S (0.25 s) continuous 4-off invalidates the lap', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]), undefined, (k) => (k >= 600 && k < 605 ? 4 : 0));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    expect(s.lastValid).toBe(false);
    expect(s.bestLap).toBeNull();
  });

  it('EDGE3: forward crossing exactly at time durationS completes the lap and sets done', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 600]));
    const s = standing(q, 0);
    expect(s.laps).toBe(1);
    close(s.lastLap, 599, 1e-6, 'car0 lastLap');
    expect(s.done).toBe(true);
    expect(q.finished).toBe(false);
  });

  it('EDGE4: update below durationS+QUALI_GRACE_S does not finish; at exactly 900 all cars become done', () => {
    const q = new QualifyingClassification(2, L, DUR);
    q.update(0, 990, 899.95, 0, DT);
    expect(q.finished).toBe(false);
    expect(standing(q, 0).done).toBe(false);
    q.update(0, 990, 900, 0, DT);
    expect(q.finished).toBe(true);
    expect(standing(q, 0).done).toBe(true);
    expect(standing(q, 1).done).toBe(true);
  });

  it('EDGE5: updates for a done (retired) car are ignored', () => {
    const q = new QualifyingClassification(2, L, DUR);
    q.retire(0);
    feed(q, 0, forward([1, 61]));
    const s = standing(q, 0);
    expect(s.done).toBe(true);
    expect(s.laps).toBe(0);
    expect(s.lastLap).toBeNull();
    expect(s.bestLap).toBeNull();
  });

  it('EDGE6: first forward crossing at time >= durationS starts no lap but sets done', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([610]));
    const s = standing(q, 0);
    expect(s.done).toBe(true);
    expect(s.laps).toBe(0);
    expect(s.lastLap).toBeNull();
    expect(s.bestLap).toBeNull();
  });

  it('EDGE7: standings put null bestLap last, order by bestLap asc, positions 1-based', () => {
    const q = new QualifyingClassification(3, L, DUR);
    feed(q, 2, forward([1, 51]));
    feed(q, 0, forward([1, 61]));
    feed(q, 1, [[0, 990]], 10);
    const s = q.standings();
    expect(s.map((x: QualiStanding) => x.car)).toEqual([2, 0, 1]);
    expect(s.map((x: QualiStanding) => x.position)).toEqual([1, 2, 3]);
    close(s[0].bestLap, 50, 1e-6, 'car2 bestLap');
    close(s[1].bestLap, 60, 1e-6, 'car0 bestLap');
    expect(s[2].bestLap).toBeNull();
  });

  it('EDGE8: fresh instance has null lastLap/lastValid/bestLap, laps 0, positions by car index', () => {
    const q = new QualifyingClassification(2, L, DUR);
    const s = q.standings();
    expect(s.map((x: QualiStanding) => x.car)).toEqual([0, 1]);
    expect(s.map((x: QualiStanding) => x.position)).toEqual([1, 2]);
    for (const st of s) {
      expect(st.laps).toBe(0);
      expect(st.bestLap).toBeNull();
      expect(st.lastLap).toBeNull();
      expect(st.lastValid).toBeNull();
      expect(st.done).toBe(false);
    }
    expect(q.finished).toBe(false);
  });

  it('EDGE9: interleaved updates keep per-car previous lapDistance for crossing detection', () => {
    const q = new QualifyingClassification(2, L, DUR);
    const keys0 = forward([1, 61]);
    const keys1 = forward([2, 62]);
    const end = 62 * TICKS;
    for (let k = 0; k <= end; k++) {
      const t = k / TICKS;
      q.update(0, distAt(keys0, t), t, 0, DT);
      q.update(1, distAt(keys1, t), t, 0, DT);
    }
    const s0 = standing(q, 0);
    const s1 = standing(q, 1);
    expect(s0.laps).toBe(1);
    close(s0.lastLap, 60, 1e-6, 'car0 lastLap');
    expect(s1.laps).toBe(1);
    close(s1.lastLap, 60, 1e-6, 'car1 lastLap');
  });

  it('EDGE10: invalid car index on update and retire is ignored', () => {
    const q = new QualifyingClassification(2, L, DUR);
    feed(q, 0, forward([1, 61]));
    expect(() => {
      q.update(-1, 5, 100, 4, DT);
      q.update(2, 5, 100, 4, DT);
      q.retire(-1);
      q.retire(2);
    }).not.toThrow();
    const s0 = standing(q, 0);
    expect(s0.laps).toBe(1);
    expect(s0.done).toBe(false);
    const s1 = standing(q, 1);
    expect(s1.laps).toBe(0);
    expect(s1.done).toBe(false);
    expect(q.finished).toBe(false);
    expect(q.standings().length).toBe(2);
  });
});

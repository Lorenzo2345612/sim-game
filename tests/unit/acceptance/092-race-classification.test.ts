import { describe, it, expect } from 'vitest';
import { RaceClassification, type Standing } from '../../../src/race/classification';

const DT = 1 / 120;
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
  stopWhenFinished = false,
): void {
  for (let k = Math.round(from * 120); k <= Math.round(to * 120); k++) {
    if (stopWhenFinished && c.finished) break;
    const t = k / 120;
    for (let i = 0; i < speeds.length; i++) {
      c.update(i, lapDistanceAt(starts[i], speeds[i], t), t);
    }
  }
}

function close(actual: number | null, expected: number, tol: number, label: string): void {
  expect(actual, `${label}: got ${actual}`).not.toBeNull();
  if (actual === null) return;
  expect(Math.abs(actual - expected), label).toBeLessThanOrEqual(tol);
}

describe('092 race classification acceptance', () => {
  it('AT1: 50/40 m/s from 990 m — lap times 20.0/25.0, totalTime 40.2/50.25, positions 1/2', () => {
    const c = new RaceClassification(2, 2, L);
    feed(c, [990, 990], [50, 40], 0, 100, true);
    expect(c.finished).toBe(true);

    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].position).toBe(1);
    close(s[0].lastLap, 20.0, 0.01, 'car0 lastLap');
    close(s[0].bestLap, 20.0, 0.01, 'car0 bestLap');
    close(s[0].totalTime, 40.2, 0.01, 'car0 totalTime');

    expect(s[1].car).toBe(1);
    expect(s[1].position).toBe(2);
    close(s[1].lastLap, 25.0, 0.01, 'car1 lastLap');
    close(s[1].bestLap, 25.0, 0.01, 'car1 bestLap');
    close(s[1].totalTime, 50.25, 0.01, 'car1 totalTime');
  });

  it('AT2: at 15 s car 1 is 3.0 ± 0.05 s behind the leader', () => {
    const c = new RaceClassification(2, 2, L);
    feed(c, [990, 990], [50, 40], 0, 15);
    const car1 = c.standings().find((s: Standing) => s.car === 1);
    if (!car1) throw new Error('car 1 missing');
    close(car1.gapToLeader, 3.0, 0.05, 'car1 gapToLeader');
  });

  it('AT3: cross, reverse back across and re-cross counts the lap once', () => {
    const c = new RaceClassification(1, 5, L);
    const samples: [number, number][] = [
      [0.0, 990],
      [0.1, 0],
      [0.2, 100],
      [0.3, 200],
      [0.4, 100],
      [0.5, 0],
      [0.6, 990],
      [0.7, 50],
      [0.8, 150],
      [0.9, 250],
    ];
    for (const [t, d] of samples) c.update(0, d, t);
    const s = c.standings()[0];
    expect(s.lap).toBe(1);
    expect(s.lastLap).toBeNull();
  });

  it('AT4: two cars 0.5 s apart, first penalised 5 s — penalised car is 2nd', () => {
    const c = new RaceClassification(2, 1, L);
    feed(c, [950, 900], [100, 100], 0, 11);
    const s = c.standings();
    close(s[0].totalTime, 10.5, 0.01, 'car0 totalTime');
    close(s[1].totalTime, 11.0, 0.01, 'car1 totalTime');

    c.addPenalty(0, 5);
    const ordered = c.standings();
    expect(ordered.find((s2: Standing) => s2.car === 0)?.position).toBe(2);
    expect(ordered.find((s2: Standing) => s2.car === 1)?.position).toBe(1);
  });

  it('AT5: at 45 s car 0 finished and race not over; after 50.25 s finished', () => {
    const c = new RaceClassification(2, 2, L);
    feed(c, [990, 990], [50, 40], 0, 45);
    const s = c.standings();
    expect(s[0].car).toBe(0);
    expect(s[0].finished).toBe(true);
    expect(s[1].car).toBe(1);
    expect(s[1].finished).toBe(false);
    expect(c.finished).toBe(false);

    feed(c, [990, 990], [50, 40], 45 + DT, 51);
    expect(c.finished).toBe(true);
  });
});

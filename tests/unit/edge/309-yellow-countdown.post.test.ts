import { describe, it, expect } from 'vitest';
import { FlagState, RACE_COUNTDOWN_S, type FlagCar } from '../../../src/race/flags';

const B: [number, number, number] = [0, 1000, 2000];
const L = 3000;
const HZ = 120;

function car(speed: number, offTrack: boolean, distance = 500): FlagCar {
  return { distance, lapDistance: distance, speed, offTrack, retired: false };
}

function sim(flags: FlagState, carAt: (t: number) => FlagCar, end: number, probe: (t: number) => void): void {
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    const t = k / HZ;
    flags.update([carAt(t)], t);
    probe(t);
  }
}

describe('309 yellow countdown post-code edges', () => {
  it('RACE_COUNTDOWN_S is 3 and countdownS defaults to 0', () => {
    expect(RACE_COUNTDOWN_S).toBe(3);
    expect(new FlagState(B, L).countdownS).toBe(0);
  });

  it('sectorCountdown throws for sectors outside 1..3', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    expect(() => f.sectorCountdown(0)).toThrow(RangeError);
    expect(() => f.sectorCountdown(4)).toThrow(RangeError);
  });

  it('a car stopped on track publishes double-yellow after the countdown', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    const seen: Record<string, string> = {};
    sim(f, () => car(0, false), 5, (t) => {
      if (Math.abs(t - 3.9) < 1e-9 || Math.abs(t - 4.5) < 1e-9) seen[t.toFixed(1)] = f.sectorFlag(1);
    });
    expect(seen['3.9']).toBe('green');
    expect(seen['4.5']).toBe('double-yellow');
  });

  it('only the sector with the cause counts down', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    sim(f, () => car(3, true, 500), 2, () => {});
    expect(f.sectorCountdown(1)).toBeGreaterThan(0);
    expect(f.sectorCountdown(2)).toBeNaN();
    expect(f.sectorCountdown(3)).toBeNaN();
    expect(f.sectorFlag(2)).toBe('green');
  });

  it('a new cause after the yellow expired starts a full new countdown', () => {
    const f = new FlagState(B, L, { countdownS: 3, minYellowS: 10, causeGapS: 2 });
    const flag: Record<string, string> = {};
    sim(f, (t) => (t < 5 || t >= 20 ? car(3, true) : car(60, false)), 24.5, (t) => {
      for (const p of [19.9, 22.9, 24.1]) if (Math.abs(t - p) < 1e-9) flag[String(p)] = f.sectorFlag(1);
    });
    expect(flag['19.9']).toBe('green');
    expect(flag['22.9']).toBe('green');
    expect(flag['24.1']).toBe('yellow');
  });

  it('a cause that clears and returns restarts the countdown from the full duration', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    let cd = Number.NaN;
    sim(f, (t) => (t >= 2 && t < 4 ? car(60, false) : car(3, true)), 5.05, (t) => {
      if (Math.abs(t - 5.05) < 1e-9) cd = f.sectorCountdown(1);
    });
    expect(cd).toBeGreaterThan(2.5);
    expect(f.sectorFlag(1)).toBe('green');
  });

  it('a large time jump with the cause present publishes the flag in one update', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    f.update([car(3, true)], 0);
    f.update([car(3, true)], 1);
    f.update([car(3, true)], 100);
    expect(f.sectorFlag(1)).toBe('yellow');
    expect(f.sectorCountdown(1)).toBeNaN();
  });

  it('countdownS 0 with the 308 options publishes yellow without any countdown', () => {
    const f = new FlagState(B, L, { minYellowS: 10, causeGapS: 2 });
    sim(f, () => car(3, true), 1.5, () => expect(f.sectorCountdown(1)).toBeNaN());
    expect(f.sectorFlag(1)).toBe('yellow');
  });

  it('retired-free empty car list and no cause never start a countdown', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    f.update([], 0);
    f.update([], 5);
    for (const s of [1, 2, 3]) expect(f.sectorCountdown(s)).toBeNaN();
    expect(f.sectorFlag(1)).toBe('green');
  });
});

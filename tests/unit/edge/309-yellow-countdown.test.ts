import { describe, it, expect } from 'vitest';
import { FlagState, RACE_COUNTDOWN_S, type FlagCar, type SectorFlag } from '../../../src/race/flags';

const B: [number, number, number] = [0, 1000, 2000];
const L = 3000;
const HZ = 120;

function car(speed: number, offTrack: boolean, distance = 500): FlagCar {
  return { distance, lapDistance: distance, speed, offTrack, retired: false };
}

interface Sample {
  flags: SectorFlag[];
  cd: number[];
}

function run(flags: FlagState, carsAt: (t: number) => FlagCar[], end: number): Sample[] {
  const out: Sample[] = [];
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    flags.update(carsAt(k / HZ), k / HZ);
    out.push({
      flags: [1, 2, 3].map((s) => flags.sectorFlag(s)),
      cd: [1, 2, 3].map((s) => flags.sectorCountdown(s)),
    });
  }
  return out;
}

function at(s: Sample[], t: number): Sample {
  return s[Math.round(t * HZ)];
}

describe('309 yellow countdown edge cases', () => {
  it('EDGE1: a stalled car on track publishes double-yellow when the countdown ends', () => {
    const s = run(new FlagState(B, L, { countdownS: 3 }), () => [car(0, false)], 4.2);
    for (const t of [1.5, 3.5, 3.9]) expect(at(s, t).flags[0], `t=${t}`).toBe('green');
    expect(at(s, 4.1).flags[0]).toBe('double-yellow');
    expect(at(s, 4.1).cd[0]).toBeNaN();
  });

  it('EDGE2: countdowns run independently per sector', () => {
    const s = run(
      new FlagState(B, L, { countdownS: 3 }),
      (t) => [car(30, true, 500), t >= 2 ? car(30, true, 1500) : car(60, false, 1500)],
      6.2,
    );
    expect(at(s, 2.5).cd[1]).toBeNaN();
    expect(Math.abs(at(s, 4).cd[1] - 2)).toBeLessThanOrEqual(0.02);
    expect(at(s, 4).cd[2]).toBeNaN();
    expect(at(s, 4.1).flags[0]).toBe('yellow');
    expect(at(s, 5.9).flags[1]).toBe('green');
    expect(at(s, 6.1).flags[1]).toBe('yellow');
    for (const t of [0.5, 4, 6.1]) {
      expect(at(s, t).flags[2], `t=${t}`).toBe('green');
      expect(at(s, t).cd[2], `t=${t}`).toBeNaN();
    }
  });

  it('EDGE3: a new cause after a cancelled countdown starts a fresh full countdown', () => {
    const s = run(
      new FlagState(B, L, { countdownS: 3 }),
      (t) => [t < 1.5 || t >= 5 ? car(30, true) : car(60, false)],
      9.2,
    );
    expect(at(s, 4.5).flags[0]).toBe('green');
    expect(at(s, 4.5).cd[0]).toBeNaN();
    expect(Math.abs(at(s, 7).cd[0] - 2)).toBeLessThanOrEqual(0.02);
    expect(at(s, 8.9).flags[0]).toBe('green');
    expect(at(s, 9.1).flags[0]).toBe('yellow');
  });

  it('EDGE4: no new countdown while the minimum-yellow hold keeps the sector yellow', () => {
    const s = run(
      new FlagState(B, L, { minYellowS: 10, causeGapS: 2, countdownS: 3 }),
      (t) => [t < 5 || (t >= 8 && t < 9) ? car(30, true) : car(60, false)],
      14.3,
    );
    expect(at(s, 3.9).flags[0]).toBe('green');
    for (let k = Math.round(4.1 * HZ); k <= Math.round(13.9 * HZ); k++) {
      expect(s[k].flags[0], `t=${k / HZ}`).toBe('yellow');
      expect(s[k].cd[0], `t=${k / HZ}`).toBeNaN();
    }
    expect(at(s, 14.1).flags[0]).toBe('green');
  });

  it('EDGE5: repeated updates at the same time do not advance the countdown', () => {
    const f = new FlagState(B, L, { countdownS: 3 });
    for (let k = 0; k <= 2 * HZ; k++) {
      const t = k / HZ;
      f.update([car(30, true)], t);
      f.update([car(30, true)], t);
    }
    expect(Math.abs(f.sectorCountdown(1) - 2)).toBeLessThanOrEqual(0.02);
    expect(f.sectorFlag(1)).toBe('green');
  });

  it('EDGE6: race countdown constant is 3 and a fresh state has no countdown', () => {
    expect(RACE_COUNTDOWN_S).toBe(3);
    const f = new FlagState(B, L, { countdownS: RACE_COUNTDOWN_S });
    expect(f.countdownS).toBe(3);
    for (const s of [1, 2, 3]) expect(f.sectorCountdown(s)).toBeNaN();
  });
});

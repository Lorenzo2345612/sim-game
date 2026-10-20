import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar, type SectorFlag } from '../../../src/race/flags';

const B: [number, number, number] = [0, 1000, 2000];
const L = 3000;
const HZ = 120;
const OPT = { minYellowS: 10, causeGapS: 2 };

function car(speed: number, offTrack: boolean, bad = false): FlagCar {
  const d = bad ? Number.NaN : 500;
  return { distance: d, lapDistance: d, speed, offTrack, retired: false };
}

function run(flags: FlagState, carAt: (t: number) => FlagCar, end: number): SectorFlag[] {
  const out: SectorFlag[] = [];
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    flags.update([carAt(k / HZ)], k / HZ);
    out.push(flags.sectorFlag(1));
  }
  return out;
}
const at = (f: SectorFlag[], t: number): SectorFlag => f[Math.round(t * HZ)];

describe('308 post', () => {
  it('POST1: an invalid-data tick resets the cause timers even with causeGapS', () => {
    const f = run(
      new FlagState(B, L, OPT),
      (t) => (t >= 0.8 && t < 0.9 ? car(30, true, true) : car(30, true)),
      1.6,
    );
    expect(at(f, 1.5)).toBe('green');
  });

  it('POST2: a single large time step keeps the minimum from the recorded onset', () => {
    const fs = new FlagState(B, L, OPT);
    fs.update([car(30, true)], 0);
    fs.update([car(30, true)], 1.5);
    fs.update([car(60, false)], 5);
    expect(fs.sectorFlag(1)).toBe('yellow');
    fs.update([car(60, false)], 100);
    expect(fs.sectorFlag(1)).toBe('green');
  });

  it('POST3: a repeated cause refreshes yellow beyond the minimum', () => {
    const f = run(new FlagState(B, L, OPT), (t) => (t < 15 ? car(30, true) : car(60, false)), 18);
    expect(at(f, 14.9)).toBe('yellow');
    expect(at(f, 16.5)).toBe('yellow');
    expect(at(f, 17.2)).toBe('green');
  });

  it('POST4: causeGapS 0 with a one-tick gap resets the timer', () => {
    const f = run(
      new FlagState(B, L, { minYellowS: 10 }),
      (t) => (Math.abs(t - 0.5) < 1e-9 ? car(60, false) : car(30, true)),
      1.3,
    );
    expect(at(f, 1.2)).toBe('green');
  });

  it('POST5: no car means a green sector with a minimum configured', () => {
    const fs = new FlagState(B, L, OPT);
    fs.update([], 0);
    fs.update([], 5);
    expect(fs.sectorFlag(1)).toBe('green');
  });
});

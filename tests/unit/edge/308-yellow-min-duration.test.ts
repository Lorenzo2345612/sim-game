import { describe, it, expect } from 'vitest';
import { FlagState, RACE_CAUSE_GAP_S, RACE_MIN_YELLOW_S, type FlagCar, type SectorFlag } from '../../../src/race/flags';

const B: [number, number, number] = [0, 1000, 2000];
const L = 3000;
const HZ = 120;

function car(speed: number, offTrack: boolean, lap = 500): FlagCar {
  return { distance: lap, lapDistance: lap, speed, offTrack, retired: false };
}

function run(flags: FlagState, carAt: (t: number) => FlagCar, end: number, sector = 1): SectorFlag[] {
  const out: SectorFlag[] = [];
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    flags.update([carAt(k / HZ)], k / HZ);
    out.push(flags.sectorFlag(sector as 1 | 2 | 3));
  }
  return out;
}

const at = (f: SectorFlag[], t: number): SectorFlag => f[Math.round(t * HZ)];

describe('308 edge', () => {
  it('EDGE1: race constants are 10 s and 2 s', () => {
    expect(RACE_MIN_YELLOW_S).toBe(10);
    expect(RACE_CAUSE_GAP_S).toBe(2);
  });

  it('EDGE2: omitted option fields default to 0', () => {
    const a = new FlagState(B, L, { minYellowS: 10 });
    expect(a.minYellowS).toBe(10);
    expect(a.causeGapS).toBe(0);
    const b = new FlagState(B, L, { causeGapS: 2 });
    expect(b.minYellowS).toBe(0);
    expect(b.causeGapS).toBe(2);
  });

  it('EDGE3: a gap shorter than causeGapS keeps the double-yellow start time', () => {
    const f = run(
      new FlagState(B, L, { minYellowS: 10, causeGapS: 2 }),
      (t) => (t >= 2.5 && t < 3 ? car(60, false) : car(0, false)),
      3.2,
    );
    expect(at(f, 3.1)).toBe('double-yellow');
  });

  it('EDGE4: a gap shorter than causeGapS keeps the yellow start time', () => {
    const f = run(
      new FlagState(B, L, { causeGapS: 2 }),
      (t) => (t < 0.5 || t >= 2.3 ? car(3, true) : car(60, false)),
      2.5,
    );
    expect(at(f, 2.4)).toBe('yellow');
  });

  it('EDGE5: a new incident after green records a new onset and holds 10 s', () => {
    const opts = { minYellowS: 10, causeGapS: 2 };
    const f = run(
      new FlagState(B, L, opts),
      (t) => (t < 1.5 || (t >= 15 && t < 16.5) ? car(3, true) : car(60, false)),
      27,
    );
    expect(at(f, 12)).toBe('green');
    expect(at(f, 24.9)).toBe('yellow');
    expect(at(f, 26.3)).toBe('green');
  });

  it('EDGE6: the minimum applies only to the affected sector', () => {
    const opts = { minYellowS: 10, causeGapS: 2 };
    const g = new FlagState(B, L, opts);
    for (let k = 0; k <= 5 * HZ; k++) g.update([car(3, true)], k / HZ);
    expect(g.sectorFlag(1)).toBe('yellow');
    expect(g.sectorFlag(2)).toBe('green');
    expect(g.sectorFlag(3)).toBe('green');
  });

  it('EDGE7: causeGapS alone does not impose a minimum', () => {
    const f = run(new FlagState(B, L, { causeGapS: 2 }), (t) => (t < 1.5 ? car(3, true) : car(60, false)), 3.7);
    expect(at(f, 3.3)).toBe('yellow');
    expect(at(f, 3.6)).toBe('green');
  });

  it('EDGE8: minYellowS alone does not bridge cause gaps', () => {
    const f = run(
      new FlagState(B, L, { minYellowS: 10 }),
      (t) => (Math.floor(Math.round(t * HZ) / 72) % 2 === 0 ? car(3, true) : car(30, false)),
      10,
    );
    for (let k = 0; k < f.length; k++) expect(f[k], `t=${k / HZ}`).toBe('green');
  });
});

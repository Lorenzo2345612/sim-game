import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { FlagState, type FlagCar, type SectorFlag } from '../../../src/race/flags';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const B: [number, number, number] = [0, 1000, 2000];
const L = 3000;
const HZ = 120;

function car(speed: number, offTrack: boolean, distance = 500): FlagCar {
  return { distance, lapDistance: distance, speed, offTrack, retired: false };
}

interface Sample {
  flag: SectorFlag;
  countdown: number;
}

function run(flags: FlagState, carAt: (t: number) => FlagCar, end: number): Sample[] {
  const out: Sample[] = [];
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    flags.update([carAt(k / HZ)], k / HZ);
    out.push({ flag: flags.sectorFlag(1), countdown: flags.sectorCountdown(1) });
  }
  return out;
}

function at(s: Sample[], t: number): Sample {
  return s[Math.round(t * HZ)];
}

describe('309 yellow countdown acceptance', () => {
  it('AT1: sector stays green during the 3 s countdown, then turns yellow', () => {
    const s = run(new FlagState(B, L, { countdownS: 3 }), () => car(3, true), 4.2);
    expect(at(s, 3.9).flag).toBe('green');
    expect(at(s, 4.1).flag).toBe('yellow');
    expect(at(s, 0.9).countdown).toBeNaN();
    expect(Math.abs(at(s, 1.1).countdown - 2.9)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(at(s, 3.9).countdown - 0.1)).toBeLessThanOrEqual(0.02);
    expect(at(s, 4.1).countdown).toBeNaN();
  });

  it('AT2: a cause that clears during the countdown cancels it and the sector stays green', () => {
    const s = run(new FlagState(B, L, { countdownS: 3 }), (t) => (t < 1.5 ? car(3, true) : car(60, false)), 8);
    for (let k = 0; k < s.length; k++) {
      expect(s[k].flag, `t=${k / HZ}`).toBe('green');
      if (k / HZ >= 3.6) expect(s[k].countdown, `t=${k / HZ}`).toBeNaN();
    }
  });

  it('AT3: overtakes during the countdown are not yellow overtakes', () => {
    const flags = new FlagState(B, L, { countdownS: 3 });
    const c0 = car(60, false, 2800);
    const c1 = car(3, true, 500);
    const log: Record<string, { car: number; passed: number }[]> = {};
    for (let k = 0; k <= Math.round(4.5 * HZ); k++) {
      const t = k / HZ;
      let d2 = 680;
      const d3 = 700;
      if ((t >= 2 && t < 3) || t >= 4.5) d2 = 720;
      flags.update([c0, c1, car(60, false, d2), car(60, false, d3)], t);
      const o = flags.overtakeUnderYellow();
      if (k === 2 * HZ || k === Math.round(4.5 * HZ)) log[String(t)] = o;
    }
    expect(log['2']).toEqual([]);
    expect(log['4.5']).toEqual([{ car: 2, passed: 3 }]);
  });

  it('AT4: without a countdown the earlier scenarios are unchanged', () => {
    const b128: [number, number, number] = [0, 500, 1000];
    const plain = new FlagState(b128, 1500);
    expect(plain.countdownS).toBe(0);
    const stopped = car(0, true, 100);
    const running = car(60, false, 100);
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      plain.update([stopped], t);
      expect(plain.sectorCountdown(1)).toBeNaN();
    }
    plain.update([running], 3.9);
    expect(plain.sectorFlag(1)).toBe('yellow');
    expect(plain.sectorCountdown(1)).toBeNaN();
    plain.update([running], 4.1);
    expect(plain.sectorFlag(1)).toBe('green');
    expect(plain.sectorCountdown(1)).toBeNaN();

    const opts = new FlagState(B, L, { minYellowS: 10, causeGapS: 2 });
    expect(opts.countdownS).toBe(0);
    const s = run(opts, (t) => (t < 1.5 ? car(3, true) : car(60, false)), 11.2);
    expect(at(s, 1.1).flag).toBe('yellow');
    expect(at(s, 10.9).flag).toBe('yellow');
    expect(at(s, 11.1).flag).toBe('green');
    for (let k = 0; k < s.length; k++) expect(s[k].countdown, `t=${k / HZ}`).toBeNaN();
  });

  it('AT5: minimum yellow duration counts from activation, not from countdown start', () => {
    const s = run(
      new FlagState(B, L, { minYellowS: 10, causeGapS: 2, countdownS: 3 }),
      (t) => (t < 5 ? car(3, true) : car(60, false)),
      14.3,
    );
    expect(at(s, 3.9).flag).toBe('green');
    expect(at(s, 4.1).flag).toBe('yellow');
    expect(at(s, 13.9).flag).toBe('yellow');
    expect(at(s, 14.1).flag).toBe('green');
  });

  it('AT6: RaceGame builds flags with the race countdown', async () => {
    const track = parseTrackData(JSON.parse(readFileSync(join(ROOT, 'public/tracks/cleveland.json'), 'utf8'))) as TrackDataV2;
    const spec = parseCarSpec(JSON.parse(readFileSync(join(ROOT, 'public/cars/f4.json'), 'utf8')));
    const cfg: RaceConfig = { trackId: 'cleveland', carId: 'f4', laps: 3, aiCount: 3, difficulty: 'expert', seed: 1 };
    const g = await RaceGame.create(track, spec, cfg);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flags = (g as any).flags as FlagState;
      expect(flags.countdownS).toBe(3);
      expect(flags.minYellowS).toBe(10);
    } finally {
      g.dispose();
    }
  }, 600000);
});

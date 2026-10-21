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
const OPTS = { minYellowS: 10, causeGapS: 2 };

function car(speed: number, offTrack: boolean): FlagCar {
  return { distance: 500, lapDistance: 500, speed, offTrack, retired: false };
}

function run(flags: FlagState, carAt: (t: number) => FlagCar, end: number): SectorFlag[] {
  const out: SectorFlag[] = [];
  for (let k = 0; k <= Math.round(end * HZ); k++) {
    flags.update([carAt(k / HZ)], k / HZ);
    out.push(flags.sectorFlag(1));
  }
  return out;
}

function at(flags: SectorFlag[], t: number): SectorFlag {
  return flags[Math.round(t * HZ)];
}

function alternating(t: number): FlagCar {
  if (t >= 20) return car(60, false);
  const off = Math.floor(Math.round(t * HZ) / 72) % 2 === 0;
  return off ? car(3, true) : car(30, false);
}

describe('308 yellow min duration acceptance', () => {
  it('AT1: default options keep today timings', () => {
    const flags = new FlagState(B, L);
    expect(flags.minYellowS).toBe(0);
    expect(flags.causeGapS).toBe(0);
    const stopped = car(0, true);
    for (const t of [0, 0.5, 1, 1.5, 2]) flags.update([stopped], t);
    flags.update([car(60, false)], 3.9);
    expect(flags.sectorFlag(1)).toBe('yellow');
    flags.update([car(60, false)], 4.1);
    expect(flags.sectorFlag(1)).toBe('green');
  });

  it('AT2: yellow holds at least 10 s after onset', () => {
    const f = run(new FlagState(B, L, OPTS), (t) => (t < 1.5 ? car(3, true) : car(60, false)), 11.2);
    expect(at(f, 1.1)).toBe('yellow');
    expect(at(f, 10.9)).toBe('yellow');
    expect(at(f, 11.1)).toBe('green');
  });

  it('AT3: alternating off/on track keeps a continuous yellow', () => {
    const f = run(new FlagState(B, L, OPTS), alternating, 22);
    for (let k = Math.round(1.2 * HZ); k <= Math.round(21.7 * HZ); k++) {
      expect(f[k], `t=${k / HZ}`).toBe('yellow');
    }
    expect(at(f, 21.9)).toBe('green');
  });

  it('AT4: without options the alternating car flickers to green', () => {
    const f = run(new FlagState(B, L), alternating, 20);
    for (let k = 0; k < f.length; k++) expect(f[k], `t=${k / HZ}`).toBe('green');
  });

  it('AT5: a cause-free gap of 2.1 s resets the timers', () => {
    const f = run(
      new FlagState(B, L, OPTS),
      (t) => (t < 0.5 || (t >= 2.6 && t < 3.4) ? car(3, true) : car(60, false)),
      3.4,
    );
    for (let k = 0; k < f.length; k++) expect(f[k], `t=${k / HZ}`).toBe('green');
  });

  it('AT6: double-yellow decays to yellow, then green after the minimum', () => {
    const f = run(new FlagState(B, L, OPTS), (t) => (t < 3.5 ? car(0, false) : car(60, false)), 11.2);
    expect(at(f, 3.1)).toBe('double-yellow');
    expect(at(f, 5.4)).toBe('double-yellow');
    expect(at(f, 5.6)).toBe('yellow');
    expect(at(f, 10.9)).toBe('yellow');
    expect(at(f, 11.1)).toBe('green');
  });

  it('AT7: RaceGame builds flags with race options', async () => {
    const track = parseTrackData(JSON.parse(readFileSync(join(ROOT, 'public/tracks/cleveland.json'), 'utf8'))) as TrackDataV2;
    const spec = parseCarSpec(JSON.parse(readFileSync(join(ROOT, 'public/cars/f4.json'), 'utf8')));
    const cfg: RaceConfig = { trackId: 'cleveland', carId: 'f4', laps: 3, aiCount: 3, difficulty: 'expert', seed: 1 };
    const g = await RaceGame.create(track, spec, cfg);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flags = (g as any).flags as FlagState;
      expect(flags.minYellowS).toBe(10);
      expect(flags.causeGapS).toBe(2);
    } finally {
      g.dispose();
    }
  }, 600000);
});

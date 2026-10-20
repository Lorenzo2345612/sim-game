import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { FlagState, type FlagCar } from '../../../src/race/flags';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BOUNDS: [number, number, number] = [0, 1000, 2000];
const LAPS = 3000;
const GO = 10;
const TICKS_PER_S = 120;

const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function car(distance: number, lapDistance: number, speed: number, offTrack = false): FlagCar {
  return { distance, lapDistance, speed, offTrack, retired: false };
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(): RaceConfig {
  return { trackId: 'cleveland', carId: 'f4', laps: 3, aiCount: 11, difficulty: 'expert', seed: 1 };
}

/** Steps until the start sequence reaches go; returns the sim time of the go tick. */
function stepToGo(game: RaceGame): number {
  for (let i = 0; i < Math.round(12 * TICKS_PER_S); i++) {
    game.step(BRAKE);
    const go = (game as unknown as { start: { goTime: number | null } }).start.goTime;
    if (go !== null) return go;
  }
  throw new Error('start sequence never reached go');
}

function sectorOfDistance(game: RaceGame, distance: number): number {
  const { sectorB1, sectorB2 } = game as unknown as { sectorB1: number; sectorB2: number };
  return distance >= sectorB2 ? 3 : distance >= sectorB1 ? 2 : 1;
}

describe('298 start yellow grace acceptance', () => {
  it('AT1: cars below CAUSE_SPEED on the grid inside the grace keep sector 3 green every tick', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.startAt(GO);
    const cars = [car(2900, 2900, 0), car(2890, 2890, 0), car(2880, 2880, 0)];
    const last = Math.round((17.9 - GO) * TICKS_PER_S);
    for (let k = 0; k <= last; k++) {
      const t = GO + k / TICKS_PER_S;
      flags.update(cars, t);
      expect(flags.sectorFlag(3), `sector 3 at t=${t}`).toBe('green');
    }
  });

  it('AT2: an overtake during the grace is not reported by overtakeUnderYellow', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.startAt(GO);
    const cars = [car(2900, 2900, 0), car(2890, 2890, 0), car(2880, 2880, 0)];
    const moved = Math.round((12 - GO) * TICKS_PER_S);
    for (let k = 0; k <= moved; k++) {
      if (k === moved) cars[2] = car(2905, 2905, 4);
      flags.update(cars, GO + k / TICKS_PER_S);
    }
    flags.update(cars, GO + (moved + 1) / TICKS_PER_S);
    expect(flags.overtakeUnderYellow()).toEqual([]);
  });

  it('AT3: a car stalled through the grace turns sector 3 yellow then double-yellow', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.startAt(GO);
    const cars = [car(2900, 2900, 0), car(2890, 2890, 0), car(2880, 2880, 0)];
    const k189 = Math.round((18.9 - GO) * TICKS_PER_S);
    const k191 = Math.round((19.1 - GO) * TICKS_PER_S);
    const k211 = Math.round((21.1 - GO) * TICKS_PER_S);
    const last = Math.round((21.5 - GO) * TICKS_PER_S);
    for (let k = 0; k <= last; k++) {
      flags.update(cars, GO + k / TICKS_PER_S);
      if (k === k189) expect(flags.sectorFlag(3), 't=18.9').toBe('green');
      if (k === k191) expect(flags.sectorFlag(3), 't=19.1').toBe('yellow');
      if (k === k211) expect(flags.sectorFlag(3), 't=21.1').toBe('double-yellow');
    }
  });

  it('AT4: an off-track cause inside the grace still raises yellow after 1 s', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.startAt(GO);
    const cars = [car(500, 500, 20, true)];
    const k111 = Math.round((11.1 - GO) * TICKS_PER_S);
    const last = Math.round((11.2 - GO) * TICKS_PER_S);
    for (let k = 0; k <= last; k++) {
      flags.update(cars, GO + k / TICKS_PER_S);
      if (k === k111) expect(flags.sectorFlag(1), 't=11.1').toBe('yellow');
    }
  });

  it('AT5: without startAt a car stopped on track still turns its sector yellow by t=1.1', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stopped = car(500, 500, 0);
    const last = Math.round(1.1 * TICKS_PER_S);
    for (let k = 0; k <= last; k++) flags.update([stopped], k / TICKS_PER_S);
    expect(flags.sectorFlag(1)).toBe('yellow');
  });

  it(
    'AT6: standing start with a braking player keeps every sector green through 8 s after go',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
      try {
        const goTime = stepToGo(game);
        while (game.simTime - goTime <= 8) {
          game.step(BRAKE);
          expect(game.flags.sectorFlag(1), `s1 at raceTime ${game.simTime - goTime}`).toBe('green');
          expect(game.flags.sectorFlag(2), `s2 at raceTime ${game.simTime - goTime}`).toBe('green');
          expect(game.flags.sectorFlag(3), `s3 at raceTime ${game.simTime - goTime}`).toBe('green');
        }
        const yellowOvertakes = game.penalties
          .entries()
          .filter((e) => e.reason === 'yellow flag overtake');
        expect(yellowOvertakes).toEqual([]);
      } finally {
        game.dispose();
      }
    },
    300000,
  );

  it(
    'AT7: 13.5 s after go the sector of the player grid slot is yellow or double-yellow',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
      try {
        const goTime = stepToGo(game);
        while (game.simTime - goTime < 13.5) game.step(BRAKE);
        const playerDistance = (game as unknown as { traffic: { distance: number }[] }).traffic[0]
          .distance;
        const flag = game.flags.sectorFlag(sectorOfDistance(game, playerDistance));
        expect(['yellow', 'double-yellow']).toContain(flag);
      } finally {
        game.dispose();
      }
    },
    300000,
  );
});

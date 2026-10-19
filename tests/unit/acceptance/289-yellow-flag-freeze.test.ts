import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { yellowCap } from '../../../src/race/yellowCap';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const MONZA_LAP_M = 5793; // official Monza length (public/tracks/monza.json)

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 3, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

/** Step until the start lights clear (go); returns the sim time of the go tick. */
function stepToGo(game: RaceGame): number {
  let sawLights = false;
  for (let i = 0; i < steps(20); i++) {
    game.step(IDLE);
    const lights = game.startLights();
    if (lights > 0) sawLights = true;
    else if (sawLights) return game.simTime;
  }
  throw new Error('start lights never cleared');
}

function standingByCar(game: RaceGame, car: number): { lap: number; distance: number } {
  const row = game.standings().find((r) => r.car === car);
  if (!row) throw new Error(`no standing for car ${car}`);
  return { lap: row.lap, distance: row.distance };
}

describe('289 yellow-flag cap skips stationary cars acceptance', () => {
  it('AT1: nearest car ahead within 30 m is stationary — skip it and cap to the next', () => {
    const cap = yellowCap(0, [100, 120, 110], [30, 20, 0], [0, 0, 0], 1000);
    expect(cap).toBe(20);
  });

  it('AT2: the car ahead is below YELLOW_FOLLOW_MIN_MS — no cap (NaN)', () => {
    const cap = yellowCap(0, [100, 120, 110], [30, 4.9, 0], [0, 0, 0], 1000);
    expect(Number.isNaN(cap)).toBe(true);
  });

  it('AT3: gap wraps across the line (20 m) — cap to the car ahead', () => {
    const cap = yellowCap(0, [990, 10], [30, 12], [0, 0], 1000);
    expect(cap).toBe(12);
  });

  it('AT4: gap above 30 m or car out of the race — no cap (NaN)', () => {
    expect(Number.isNaN(yellowCap(0, [100, 131], [30, 20], [0, 0], 1000))).toBe(true);
    expect(Number.isNaN(yellowCap(0, [100, 120], [30, 20], [0, 1], 1000))).toBe(true);
  });

  it('AT5: both bounds inclusive — gap 30 m and speed 5 m/s are used', () => {
    const cap = yellowCap(0, [100, 130], [30, 5], [0, 0], 1000);
    expect(cap).toBe(5);
  });

  it(
    'AT6: player parked on the grid — every AI is past one lap and beyond 5793 m after 200 s',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
      try {
        const goTime = stepToGo(game);
        while (game.simTime < goTime + 200) game.step(IDLE);
        for (const car of [1, 2, 3]) {
          const st = standingByCar(game, car);
          expect(st.lap, `AI ${car} lap`).toBeGreaterThanOrEqual(2);
          expect(st.distance, `AI ${car} distance`).toBeGreaterThan(MONZA_LAP_M);
        }
      } finally {
        game.dispose();
      }
    },
    400000,
  );

  it(
    'AT7: a debug-stopped car under yellow does not freeze the cars behind it',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
      try {
        const goTime = stepToGo(game);
        while (game.simTime < goTime + 5) game.step(IDLE);
        const atStop2 = standingByCar(game, 2).distance;
        const atStop3 = standingByCar(game, 3).distance;
        game.debugStopCar(1);
        while (game.simTime < goTime + 120) game.step(IDLE);
        const car2 = standingByCar(game, 2);
        const car3 = standingByCar(game, 3);
        const car1 = standingByCar(game, 1);
        expect(car2.distance - atStop2, 'car 2 moved since the stop').toBeGreaterThanOrEqual(2000);
        expect(car3.distance - atStop3, 'car 3 moved since the stop').toBeGreaterThanOrEqual(2000);
        expect(car2.distance, 'car 2 race distance vs car 1').toBeGreaterThan(car1.distance);
        expect(car3.distance, 'car 3 race distance vs car 1').toBeGreaterThan(car1.distance);
      } finally {
        game.dispose();
      }
    },
    300000,
  );
});

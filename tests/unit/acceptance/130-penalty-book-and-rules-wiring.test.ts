import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { PenaltyBook } from '../../../src/race/penalties';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

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
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 5, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

describe('130 penalty book and rules wiring acceptance', () => {
  it('AT1: 3 warnings and 2 penalties of 5 s for one car — total(car) is 10', () => {
    const book = new PenaltyBook(1);
    book.add(0, 'warning', 0, 'track limits', 1);
    book.add(0, 'warning', 0, 'track limits', 2);
    book.add(0, 'warning', 0, 'track limits', 3);
    book.add(0, 'penalty', 5, 'track limits', 4);
    book.add(0, 'penalty', 5, 'track limits', 5);
    expect(book.total(0)).toBe(10);
  });

  it('AT2: stop AI 1 at 30 s over 60 s — VSC deployed by 40.1 s, every AI delta >= -0.5, no AI penalty', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
    try {
      let forced = false;
      let deployedAt = Number.POSITIVE_INFINITY;
      for (let i = 0; i < steps(60); i++) {
        game.step(IDLE);
        if (!forced && game.simTime >= 30) {
          game.debugStopCar(1);
          forced = true;
        }
        if (deployedAt === Number.POSITIVE_INFINITY && game.vsc.phase === 'deployed') {
          deployedAt = game.simTime;
        }
      }
      expect(forced, 'stop hook called by 30 s').toBe(true);
      expect(deployedAt, 'first deployed sim time').toBeLessThanOrEqual(40.1);
      for (let car = 1; car <= 5; car++) {
        // NaN inputs return the stored per-tick delta without mutating Vsc state.
        const delta = game.vsc.delta(car, Number.NaN, Number.NaN);
        expect(delta, `AI ${car} delta`).toBeGreaterThanOrEqual(-0.5);
        expect(game.penalties.total(car), `AI ${car} penalty seconds`).toBe(0);
      }
    } finally {
      game.dispose();
    }
  }, 120000);
});

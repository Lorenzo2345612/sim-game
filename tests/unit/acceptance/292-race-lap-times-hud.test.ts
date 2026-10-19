import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { RaceClassification, type Standing } from '../../../src/race/classification';
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
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 3, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function rowOf(rows: readonly Standing[], car: number): Standing {
  const row = rows.find((r) => r.car === car);
  if (row === undefined) throw new Error(`no standing row for car ${car}`);
  return row;
}

describe('292 race lap times HUD acceptance', () => {
  it('AT1: before the first line crossing lapStartTime(0) is null', () => {
    const c = new RaceClassification(1, 3, 1000);
    c.update(0, 950, 10);
    expect(c.lapStartTime(0)).toBeNull();
  });

  it('AT2: the first crossing starts the lap at 10.5 ± 1e-9', () => {
    const c = new RaceClassification(1, 3, 1000);
    c.update(0, 950, 10);
    c.update(0, 50, 11);
    expect(c.lapStartTime(0)).toBeCloseTo(10.5, 9);
  });

  it('AT3: the next crossing moves lapStartTime to 30.5 ± 1e-9 and lastLap to 20 ± 1e-9', () => {
    const c = new RaceClassification(1, 3, 1000);
    c.update(0, 950, 10);
    c.update(0, 50, 11);
    c.update(0, 500, 20);
    c.update(0, 950, 30);
    c.update(0, 50, 31);
    expect(c.lapStartTime(0)).toBeCloseTo(30.5, 9);
    expect(c.standings()[0].lastLap).toBeCloseTo(20, 9);
  });

  async function raceAfterGo(seconds: number): Promise<RaceGame> {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
    let prev = game.startLights();
    let wentGo = false;
    for (let i = 0; i < steps(20) && !wentGo; i++) {
      game.step(IDLE);
      const lights = game.startLights();
      if (prev > 0 && lights === 0) wentGo = true;
      prev = lights;
    }
    if (!wentGo) {
      game.dispose();
      throw new Error('start sequence never reached go');
    }
    for (let i = 0; i < steps(seconds); i++) game.step(IDLE);
    return game;
  }

  it(
    'AT4: 60 s after go the idle player shows lap 0 with null times and valid true',
    async () => {
      const game = await raceAfterGo(60);
      try {
        expect(game.getLapInfo(0)).toEqual({
          lap: 0,
          currentLapTime: null,
          lastLapTime: null,
          bestLapTime: null,
          valid: true,
        });
      } finally {
        game.dispose();
      }
    },
    180000,
  );

  it(
    'AT5: 60 s after go the pole AI lap info matches its standings row, currentLapTime in (0, 60]',
    async () => {
      const game = await raceAfterGo(60);
      try {
        const row = rowOf(game.standings(), 1);
        const info = game.getLapInfo(1);
        expect(info.lap, 'lap >= 1').toBeGreaterThanOrEqual(1);
        expect(info.lap, 'lap matches standings row').toBe(row.lap);
        expect(info.currentLapTime, 'currentLapTime > 0').toBeGreaterThan(0);
        expect(info.currentLapTime, 'currentLapTime <= 60').toBeLessThanOrEqual(60);
        expect(info.lastLapTime, 'lastLapTime matches row').toBe(row.lastLap);
        expect(info.bestLapTime, 'bestLapTime matches row').toBe(row.bestLap);
      } finally {
        game.dispose();
      }
    },
    180000,
  );

  it('AT6: getLapInfo(4) and getLapInfo(-1) throw RangeError', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
    try {
      expect(() => game.getLapInfo(4)).toThrow(RangeError);
      expect(() => game.getLapInfo(-1)).toThrow(RangeError);
    } finally {
      game.dispose();
    }
  }, 60000);
});

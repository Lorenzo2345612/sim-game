import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { TroubleTracker } from '../../../src/race/trouble';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

async function makeGame(): Promise<RaceGame> {
  const track = parseTrackData(readJson('public/tracks/cleveland.json')) as TrackDataV2;
  const spec = parseCarSpec(readJson('public/cars/f4.json'));
  const cfg: RaceConfig = {
    trackId: 'cleveland',
    carId: 'f4',
    laps: 3,
    aiCount: 3,
    difficulty: 'expert',
    seed: 1,
  };
  return RaceGame.create(track, spec, cfg);
}

function stepToElapsed(game: RaceGame, seconds: number): void {
  for (let i = 0; i < 120 * 200 && game.raceElapsed < seconds; i++) game.step(BRAKE);
  expect(game.raceElapsed).toBeGreaterThanOrEqual(seconds);
}

describe('307 yellow pass cars in trouble acceptance', () => {
  it('AT1: off-track marks trouble for 10 s only for that car', () => {
    const t = new TroubleTracker(2);
    t.update(0, true, 30, 100);
    expect(t.inTrouble(0, 100)).toBe(true);
    expect(t.inTrouble(0, 109.99)).toBe(true);
    expect(t.inTrouble(0, 110.01)).toBe(false);
    expect(t.inTrouble(1, 100)).toBe(false);
  });

  it('AT2: speed below 5 m/s marks trouble', () => {
    const t = new TroubleTracker(2);
    t.update(0, false, 4.9, 50);
    t.update(1, false, 5, 50);
    expect(t.inTrouble(0, 50)).toBe(true);
    expect(t.inTrouble(1, 50)).toBe(false);
  });

  it('AT3: mark holds 10 s even with healthy updates', () => {
    const t = new TroubleTracker(2);
    t.mark(1, 20);
    for (let time = 20; time <= 31; time += DT) t.update(1, false, 40, time);
    expect(t.inTrouble(1, 29.9)).toBe(true);
    expect(t.inTrouble(1, 30.1)).toBe(false);
  });

  it('AT4: a respawned car stays in trouble for 9.9 s', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      stepToElapsed(game, 30);
      game.debugRespawn(2);
      expect(game.isInTrouble(2)).toBe(true);
      for (let i = 0; i < Math.round(9.9 / DT); i++) {
        game.step(BRAKE);
        expect(game.isInTrouble(2)).toBe(true);
      }
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT5: debugRespawn rejects car 0 and out of range', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      stepToElapsed(game, 30);
      expect(() => game.debugRespawn(0)).toThrow(RangeError);
      expect(() => game.debugRespawn(4)).toThrow(RangeError);
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT6: a give-back owed to a car in trouble is voided', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      stepToElapsed(game, 30);
      game.debugRespawn(2);
      game.debugGiveBack(1, 2);
      for (let i = 0; i < Math.round(12 / DT); i++) game.step(BRAKE);
      const pens = game.penalties.forCar(1).filter((p) => p.reason === 'yellow flag overtake');
      expect(pens).toEqual([]);
    } finally {
      game.dispose();
    }
  }, 600000);
});

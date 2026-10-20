import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { GiveBack } from '../../../src/race/giveBack';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const NONE = [false, false, false];

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

function distOf(game: RaceGame, car: number): number {
  return game.standings().find((s) => s.car === car)!.distance;
}

function yellowPenalties(game: RaceGame, car: number): { seconds: number }[] {
  return game.penalties.forCar(car).filter((p) => p.reason === 'yellow flag overtake');
}

describe('305 yellow overtake give back acceptance', () => {
  it('AT1: returning the position closes the entry as returned', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], NONE, 105);
    gb.update([995, 1000, 0], NONE, 105.5);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'returned' }]);
    gb.update([995, 1000, 0], NONE, 111);
    expect(gb.drainEvents()).toEqual([]);
    expect(gb.owes(0)).toBe(-1);
  });

  it('AT2: keeping the position for 10 s books a penalty event', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    const d = [1010, 1000, 0];
    gb.update(d, NONE, 109.99);
    expect(gb.drainEvents()).toEqual([]);
    expect(gb.remaining(0, 109.99)).toBeCloseTo(0.01, 9);
    gb.update(d, NONE, 110);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'penalty' }]);
    expect(gb.owes(0)).toBe(-1);
    expect(gb.remaining(0, 110)).toBeNaN();
  });

  it('AT3: the owed car stopping voids the entry', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], [false, true, false], 103);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'void' }]);
  });

  it('AT4: duplicate pair is ignored and entries expire independently', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.open(0, 1, 101);
    gb.open(0, 2, 102);
    gb.update([1010, 1000, 1005], NONE, 111);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'penalty' }]);
  });

  it('AT5: equal distances do not count as returned', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1000, 1000, 0], NONE, 105);
    expect(gb.drainEvents()).toEqual([]);
  });

  it('AT7: isGiveBack is true for the owed car and for 2 s after returning', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    expect(gb.isGiveBack(1, 0, 101)).toBe(true);
    gb.update([995, 1000, 0], NONE, 105.5);
    expect(gb.isGiveBack(1, 0, 105.5)).toBe(true);
    expect(gb.isGiveBack(1, 0, 107.4)).toBe(true);
    expect(gb.isGiveBack(1, 0, 107.6)).toBe(false);
    expect(gb.isGiveBack(0, 1, 105.5)).toBe(false);
    expect(gb.isGiveBack(2, 0, 105.5)).toBe(false);
  });

  it('AT6: an AI that owes a position gives it back without a penalty', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      stepToElapsed(game, 40);
      const rows = game.standings();
      let pair: [number, number] | null = null;
      for (let i = 0; i + 1 < rows.length; i++) {
        const a = rows[i];
        const b = rows[i + 1];
        if (a.car >= 1 && b.car >= 1 && a.distance - b.distance <= 150) {
          pair = [a.car, b.car];
          break;
        }
      }
      expect(pair).not.toBeNull();
      const [a, b] = pair!;
      game.debugGiveBack(a, b);
      let returned = false;
      for (let i = 0; i < Math.round(10 / DT); i++) {
        game.step(BRAKE);
        if (distOf(game, b) > distOf(game, a)) returned = true;
      }
      expect(returned).toBe(true);
      expect(yellowPenalties(game, a)).toEqual([]);
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT8: the player owing a position gets a 5 s penalty only if it keeps it', async () => {
    const game = await makeGame();
    try {
      game.setPlayerAutopilot(true);
      stepToElapsed(game, 40);
      const rows = game.standings();
      const c = rows[rows.length - 1].car;
      game.debugGiveBack(0, c);
      const pg = game.playerGiveBack;
      expect(pg).not.toBeNull();
      expect(pg!.passed).toBe(c);
      expect(pg!.remaining).toBeCloseTo(10, 2);
      let stayedAhead = true;
      for (let i = 0; i < Math.round(10.5 / DT); i++) {
        game.step(BRAKE);
        if (distOf(game, 0) <= distOf(game, c)) stayedAhead = false;
      }
      const pens = yellowPenalties(game, 0);
      if (stayedAhead) {
        expect(pens.length).toBe(1);
        expect(pens[0].seconds).toBe(5);
      } else {
        expect(pens).toEqual([]);
      }
      expect(game.playerGiveBack).toBeNull();
    } finally {
      game.dispose();
    }
  }, 600000);
});

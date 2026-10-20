import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig, type RaceSessionConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const THROTTLE: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function sessionConfig(
  session: RaceSessionConfig,
  aiCount = 1,
  gridOrder?: number[],
): RaceConfig {
  const base: RaceConfig = {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty: 'medium',
    seed: 1,
    gridOrder,
  };
  return Object.assign(base, { session });
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function xs(game: RaceGame, out: VehicleState[]): { x: number; z: number }[] {
  game.getStates(out);
  return out.map((s: VehicleState) => ({ x: s.position.x, z: s.position.z }));
}

function moved(
  game: RaceGame,
  out: VehicleState[],
  at: readonly { x: number; z: number }[],
  car: number,
): number {
  game.getStates(out);
  const p = out[car].position;
  return Math.hypot(p.x - at[car].x, p.z - at[car].z);
}

function requireTimeLeft(game: RaceGame): number {
  const left = game.timeLeft;
  if (typeof left !== 'number') throw new Error(`timeLeft is not a number: ${String(left)}`);
  return left;
}

describe('278 RaceGame timed sessions edge', () => {
  it('EDGE1: create rejects a timed session without a positive session.minutes and accepts an explicit race session without minutes', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    await expect(
      RaceGame.create(track, spec, sessionConfig({ kind: 'qualifying' })),
    ).rejects.toThrow(/session\.minutes/);
    await expect(
      RaceGame.create(track, spec, sessionConfig({ kind: 'qualifying', minutes: 0 })),
    ).rejects.toThrow(/session\.minutes/);
    await expect(
      RaceGame.create(track, spec, sessionConfig({ kind: 'practice', minutes: -1 })),
    ).rejects.toThrow(/session\.minutes/);
    const game = await RaceGame.create(track, spec, sessionConfig({ kind: 'race' }));
    try {
      expect(game.timeLeft, 'explicit race session timeLeft null').toBeNull();
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE2: timed session reports startLights 0 at t=0 and while the race lights would be counting', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }),
    );
    try {
      expect(game.startLights(), 'startLights 0 at t=0').toBe(0);
      for (let i = 0; i < steps(3); i++) game.step(BRAKE);
      expect(game.startLights(), 'startLights 0 at 3 s').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE3: practice session is timed — startPhase go and timeLeft minutes*60 at t=0', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'practice', minutes: 2 }),
    );
    try {
      expect(game.startPhase, 'startPhase go').toBe('go');
      expect(requireTimeLeft(game), 'timeLeft 120').toBeCloseTo(120, 10);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE4: fractional minutes convert to seconds — 0.5 min gives timeLeft 30 at t=0', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 0.5 }),
    );
    try {
      expect(requireTimeLeft(game), 'timeLeft 30').toBeCloseTo(30, 10);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE5: timeLeft clamps at 0 once simTime passes minutes*60', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 0.05 }),
    );
    try {
      for (let i = 0; i < steps(4); i++) game.step(BRAKE);
      const left = requireTimeLeft(game);
      expect(left, 'timeLeft not negative').toBeGreaterThanOrEqual(0);
      expect(left, 'timeLeft 0 at 4 s of a 3 s session').toBeCloseTo(0, 10);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE6: sessionFinished follows the classification — still false just past the duration', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 0.05 }),
    );
    try {
      for (let i = 0; i < steps(4); i++) game.step(BRAKE);
      expect(game.sessionFinished, 'sessionFinished false at 4 s of a 3 s session').toBe(false);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE7: player on the last grid slot of the default order is held — throttle ignored until 2*aiCount s', async () => {
    // Default order [1, 0]: player at grid position 1, released at 2.0 s.
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }, 1),
    );
    try {
      const out = buffers(2);
      const at = xs(game, out);
      for (let i = 0; i < steps(1.9); i++) game.step(THROTTLE);
      const held = moved(game, out, at, 0);
      for (let i = steps(1.9); i < steps(4); i++) game.step(THROTTLE);
      const free = moved(game, out, at, 0);
      expect(held, 'player (grid pos 1) held at 1.9 s').toBeLessThan(0.2);
      expect(free, 'player moving by 4.0 s').toBeGreaterThan(0.5);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('EDGE8: grid hold follows the effective grid order — inverted order frees car 2 and holds the player', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }, 2, [2, 1, 0]),
    );
    try {
      const out = buffers(3);
      const at = xs(game, out);
      for (let i = 0; i < steps(1.5); i++) game.step(THROTTLE);
      const car2 = moved(game, out, at, 2);
      for (let i = steps(1.5); i < steps(3.9); i++) game.step(THROTTLE);
      const playerHeld = moved(game, out, at, 0);
      for (let i = steps(3.9); i < steps(6); i++) game.step(THROTTLE);
      const playerFree = moved(game, out, at, 0);
      expect(car2, 'car 2 (grid pos 0) moved > 0.5 m by 1.5 s').toBeGreaterThan(0.5);
      expect(playerHeld, 'player (grid pos 2) held at 3.9 s').toBeLessThan(0.2);
      expect(playerFree, 'player moving by 6.0 s').toBeGreaterThan(0.5);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('EDGE9: no jump-start penalty when a car leaves its slot early in a timed session', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }, 1, [0, 1]),
    );
    try {
      const out = buffers(2);
      const at = xs(game, out);
      for (let i = 0; i < steps(2); i++) game.step(THROTTLE);
      expect(moved(game, out, at, 0), 'player (grid pos 0) moved > 0.5 m by 2 s').toBeGreaterThan(
        0.5,
      );
      expect(game.penalties.count(0, 'jump start'), 'no jump-start penalty').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE10: qualiStandings returns a fresh array with stable content', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }),
    );
    try {
      const a = game.qualiStandings();
      const b = game.qualiStandings();
      expect(a.length, 'one row per car').toBe(2);
      expect(a, 'fresh array').not.toBe(b);
      expect(a, 'stable content').toEqual(b);
    } finally {
      game.dispose();
    }
  }, 120000);
});

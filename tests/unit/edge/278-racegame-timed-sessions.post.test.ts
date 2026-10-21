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
const STEER: DriverInput = { throttle: 1, brake: 0, steer: 1, reset: false };

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
): RaceConfig {
  const base: RaceConfig = {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty: 'medium',
    seed: 1,
  };
  return Object.assign(base, { session });
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function requireTimeLeft(game: RaceGame): number {
  const left = game.timeLeft;
  if (typeof left !== 'number') throw new Error(`timeLeft is not a number: ${String(left)}`);
  return left;
}

function penaltyOf(game: RaceGame, car: number): number {
  const row = game.standings().find((r) => r.car === car);
  if (row === undefined) throw new Error(`no standing for car ${car}`);
  return row.penalty;
}

describe('278 RaceGame timed sessions post-code gaps', () => {
  it('POST1: create rejects non-finite and non-number session.minutes and accepts a tiny positive one', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    await expect(
      RaceGame.create(track, spec, sessionConfig({ kind: 'qualifying', minutes: Number.NaN })),
    ).rejects.toThrow(/session\.minutes/);
    await expect(
      RaceGame.create(
        track,
        spec,
        sessionConfig({ kind: 'practice', minutes: Number.POSITIVE_INFINITY }),
      ),
    ).rejects.toThrow(/session\.minutes/);
    await expect(
      RaceGame.create(
        track,
        spec,
        sessionConfig({ kind: 'qualifying', minutes: '2' as unknown as number }),
      ),
    ).rejects.toThrow(/session\.minutes/);
    const game = await RaceGame.create(
      track,
      spec,
      sessionConfig({ kind: 'qualifying', minutes: 1e-9 }),
    );
    try {
      const left = requireTimeLeft(game);
      expect(left, 'tiny positive minutes accepted').toBeGreaterThanOrEqual(0);
      expect(left, 'timeLeft is minutes*60').toBeLessThan(1e-6);
    } finally {
      game.dispose();
    }
    const long = await RaceGame.create(
      track,
      spec,
      sessionConfig({ kind: 'qualifying', minutes: 1e6 }),
    );
    try {
      expect(requireTimeLeft(long), 'large minutes accepted').toBeCloseTo(6e7, 6);
    } finally {
      long.dispose();
    }
  }, 120000);

  it('POST2: a race kind ignores its minutes field and stays a race session', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'race', minutes: 0 }),
    );
    try {
      expect(game.startPhase, 'startPhase grid').toBe('grid');
      expect(game.timeLeft, 'timeLeft null').toBeNull();
      expect(game.qualiStandings(), 'qualiStandings []').toEqual([]);
      expect(game.sessionFinished, 'sessionFinished false').toBe(false);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST3: session getters do not mutate the simulation', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }),
    );
    try {
      for (let i = 0; i < steps(2); i++) game.step(BRAKE);
      const t0 = game.simTime;
      const left0 = requireTimeLeft(game);
      const rows0 = game.qualiStandings();
      expect(game.startPhase, 'startPhase go').toBe('go');
      expect(game.sessionFinished, 'sessionFinished false').toBe(false);
      expect(game.timeLeft, 'timeLeft readable').toBe(left0);
      const rows1 = game.qualiStandings();
      expect(game.simTime, 'simTime unchanged').toBe(t0);
      expect(requireTimeLeft(game), 'timeLeft unchanged').toBe(left0);
      expect(rows1, 'standings content unchanged').toEqual(rows0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST4: grid hold forces steering 0 — the wheel angle only responds after release', async () => {
    // Default order [1, 0]: the player is on grid position 2 and held until 2.0 s.
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }, 1),
    );
    try {
      const out = buffers(2);
      for (let i = 0; i < steps(1.9); i++) game.step(STEER);
      game.getStates(out);
      const held = Math.abs(out[0].wheels[0].steering);
      for (let i = steps(1.9); i < steps(3); i++) game.step(STEER);
      game.getStates(out);
      const free = Math.abs(out[0].wheels[0].steering);
      expect(held, 'steering pinned to 0 while grid-held').toBeLessThan(1e-6);
      expect(free, 'steering responds after release').toBeGreaterThan(0.1);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('POST5: track-limit penalties reach the PenaltyBook but not the race classification in a timed session', async () => {
    const timed = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 1 }, 1),
    );
    try {
      timed.debugForceTrackLimits(1, 4);
      expect(timed.penalties.count(1, 'track limits'), 'penalty booked').toBe(1);
      expect(timed.penalties.total(1), '5 s booked').toBe(5);
      expect(penaltyOf(timed, 1), 'no race-classification penalty').toBe(0);
    } finally {
      timed.dispose();
    }
    const race = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'race' }, 1),
    );
    try {
      race.debugForceTrackLimits(1, 4);
      expect(penaltyOf(race, 1), 'race classification penalty 5').toBe(5);
    } finally {
      race.dispose();
    }
  }, 180000);

  it('POST6: a timed session with no AI runs alone — the pole car is not grid-held', async () => {
    const game = await RaceGame.create(
      loadTrack(),
      loadSpec(),
      sessionConfig({ kind: 'qualifying', minutes: 0.5 }, 0),
    );
    try {
      const out = buffers(1);
      game.getStates(out);
      const at = { x: out[0].position.x, z: out[0].position.z };
      for (let i = 0; i < steps(1.5); i++) game.step(STEER);
      game.getStates(out);
      const moved = Math.hypot(out[0].position.x - at.x, out[0].position.z - at.z);
      expect(moved, 'sole car released at t=0').toBeGreaterThan(0.5);
      const rows = game.qualiStandings();
      expect(rows.length, 'one quali row').toBe(1);
      expect(rows[0].car, 'row is the player').toBe(0);
      expect(requireTimeLeft(game), 'timeLeft tracks the clock').toBeCloseTo(30 - game.simTime, 6);
    } finally {
      game.dispose();
    }
  }, 180000);
});

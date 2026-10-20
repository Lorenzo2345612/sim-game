import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig, type RaceSessionConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { QualiStanding } from '../../../src/race/qualifying';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number, difficulty: RaceConfig['difficulty'] = 'medium'): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty, seed: 1 };
}

function qualiConfig(
  aiCount: number,
  minutes: number,
  difficulty: RaceConfig['difficulty'] = 'medium',
): RaceConfig {
  const session: RaceSessionConfig = { kind: 'qualifying', minutes };
  return Object.assign(raceConfig(aiCount, difficulty), { session });
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function rowOf(rows: readonly QualiStanding[], car: number): QualiStanding {
  const row = rows.find((r: QualiStanding) => r.car === car);
  if (row === undefined) throw new Error(`no quali standing for car ${car}`);
  return row;
}

describe('278 RaceGame timed sessions acceptance', () => {
  it(
    'AT1: qualifying 1 min at t=0 — startPhase go, timeLeft 60',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), qualiConfig(3, 1));
      try {
        expect(game.startPhase, 'startPhase go').toBe('go');
        expect(game.timeLeft, 'timeLeft 60').toBe(60);
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT2: grid hold by position — car 1 moves by 1.5 s, car 3 held at 3.9 s and moving by 6.0 s',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), qualiConfig(3, 1));
      try {
        const out = buffers(4);
        game.getStates(out);
        const at = out.map((s: VehicleState) => ({ x: s.position.x, z: s.position.z }));
        // Horizontal only: every car drops ~0.3 m in y from the spawn height at t=0.
        const moved = (car: number): number => {
          game.getStates(out);
          const p = out[car].position;
          return Math.hypot(p.x - at[car].x, p.z - at[car].z);
        };
        for (let i = 0; i < steps(1.5); i++) game.step(BRAKE);
        const car1 = moved(1);
        for (let i = steps(1.5); i < steps(3.9); i++) game.step(BRAKE);
        const car3Held = moved(3);
        for (let i = steps(3.9); i < steps(6); i++) game.step(BRAKE);
        const car3Free = moved(3);
        expect(car1, 'car 1 (grid pos 0) moved > 0.5 m by 1.5 s').toBeGreaterThan(0.5);
        expect(car3Held, 'car 3 (grid pos 2) moved < 0.2 m at 3.9 s').toBeLessThan(0.2);
        expect(car3Free, 'car 3 (grid pos 2) moved > 0.5 m at 6.0 s').toBeGreaterThan(0.5);
      } finally {
        game.dispose();
      }
    },
    180000,
  );

  it(
    'AT3: 10 s into a 1 min session — timeLeft 50 (1e-6)',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), qualiConfig(3, 1));
      try {
        for (let i = 0; i < steps(10); i++) game.step(BRAKE);
        const left = game.timeLeft;
        if (typeof left !== 'number') throw new Error(`timeLeft is not a number: ${String(left)}`);
        expect(Math.abs(left - 50), 'timeLeft 50 within 1e-6').toBeLessThanOrEqual(1e-6);
      } finally {
        game.dispose();
      }
    },
    180000,
  );

  it(
    'AT4: parked player, 1 min qualifying — finished by 360.02 s, AI laps >= 1, player laps 0 done',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), qualiConfig(1, 1, 'expert'), {
        aiDriver: 'classic',
      });
      try {
        for (let i = 0; i < steps(361) && !game.sessionFinished; i++) game.step(BRAKE);
        expect(game.sessionFinished, 'sessionFinished').toBe(true);
        expect(game.simTime, 'finished by simTime <= 360.02 s').toBeLessThanOrEqual(360.02);
        const rows = game.qualiStandings();
        const player = rowOf(rows, 0);
        const ai = rowOf(rows, 1);
        expect(player.laps, 'player laps 0').toBe(0);
        expect(player.bestLap, 'player bestLap null').toBeNull();
        expect(player.done, 'player done').toBe(true);
        expect(ai.laps, 'AI laps >= 1').toBeGreaterThanOrEqual(1);
        if (ai.bestLap !== null) {
          expect(ai.bestLap, 'AI bestLap >= 60 s').toBeGreaterThanOrEqual(60);
          expect(ai.bestLap, 'AI bestLap <= 240 s').toBeLessThanOrEqual(240);
        }
      } finally {
        game.dispose();
      }
    },
    1200000,
  );

  it(
    'AT5: race session (no session) at t=0 — startPhase grid, timeLeft null, qualiStandings []',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(3));
      try {
        expect(game.startPhase, 'startPhase grid').toBe('grid');
        expect(game.timeLeft, 'timeLeft null').toBeNull();
        expect(game.qualiStandings(), 'qualiStandings []').toEqual([]);
      } finally {
        game.dispose();
      }
    },
    60000,
  );
});

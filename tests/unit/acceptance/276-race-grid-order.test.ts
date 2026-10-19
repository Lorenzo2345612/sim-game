import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createVehicleState } from '../../../src/core/interpolation';
import type { TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const TOL = 0.05;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number, gridOrder?: number[]): RaceConfig {
  const base: RaceConfig = {
    trackId: 'monza',
    carId: 'f4',
    laps: 3,
    aiCount,
    difficulty: 'medium',
    seed: 1,
  };
  return gridOrder === undefined ? base : Object.assign(base, { gridOrder });
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

describe('276 race grid order acceptance', () => {
  it(
    'AT1: gridOrder [2,0,3,1], aiCount 3 — car 2 at slot 0, car 0 slot 1, car 3 slot 2, car 1 slot 3 (0.05 m)',
    async () => {
      const track = loadTrack();
      const order = [2, 0, 3, 1];
      const game = await RaceGame.create(track, loadSpec(), raceConfig(3, order));
      try {
        const states = game.getStates(buffers(4));
        const slots = gridSlots(track, 4);
        for (let p = 0; p < 4; p++) {
          const pos = states[order[p]].position;
          expect(Math.abs(pos.x - slots[p].position.x), `slot ${p} x`).toBeLessThanOrEqual(TOL);
          expect(Math.abs(pos.z - slots[p].position.z), `slot ${p} z`).toBeLessThanOrEqual(TOL);
        }
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT2: no gridOrder, aiCount 3 — car 0 at slot 3, car k+1 at slot k (0.05 m)',
    async () => {
      const track = loadTrack();
      const game = await RaceGame.create(track, loadSpec(), raceConfig(3));
      try {
        const states = game.getStates(buffers(4));
        const slots = gridSlots(track, 4);
        for (let i = 0; i < 4; i++) {
          const slot = i === 0 ? slots[3] : slots[i - 1];
          const pos = states[i].position;
          expect(Math.abs(pos.x - slot.position.x), `car ${i} x`).toBeLessThanOrEqual(TOL);
          expect(Math.abs(pos.z - slot.position.z), `car ${i} z`).toBeLessThanOrEqual(TOL);
        }
      } finally {
        game.dispose();
      }
    },
    60000,
  );

  it(
    'AT3: invalid gridOrder ([0,1,2], [0,0,1,2], [0,1,2,4]), aiCount 3 — create rejects with message containing gridOrder',
    async () => {
      const track = loadTrack();
      const spec = loadSpec();
      const invalid: number[][] = [
        [0, 1, 2],
        [0, 0, 1, 2],
        [0, 1, 2, 4],
      ];
      for (const gridOrder of invalid) {
        await expect(
          RaceGame.create(track, spec, raceConfig(3, gridOrder)),
          `gridOrder ${JSON.stringify(gridOrder)}`,
        ).rejects.toThrow(/gridOrder/);
      }
    },
    60000,
  );
});

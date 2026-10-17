import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const N = 72;
const R = 50;
const ELEV = 1.5;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function loadHybridSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/ow26.json'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function raceConfig(aiCount: number, over: Partial<RaceConfig> = {}): RaceConfig {
  return {
    trackId: 'post-093',
    carId: 'f4',
    laps: 1,
    aiCount,
    difficulty: 'medium',
    seed: 1,
    ...over,
  };
}

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    centerline.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return {
    version: 2,
    id: 'post-093',
    name: 'Post 093 ring',
    widthMeters: 16,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, N / 3, (2 * N) / 3],
    elevation: new Array<number>(N).fill(ELEV),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: {
      originX: 0,
      originZ: 0,
      sizeX: 240,
      sizeZ: 240,
      rows: 1,
      cols: 1,
      heights: [0, 0, 0, 0],
    },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 1, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com', dem: 'test.tif' },
  };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function penaltyOf(game: RaceGame, car: number): number {
  return game.standings().find((s) => s.car === car)?.penalty ?? 0;
}

function stepUntilGo(game: RaceGame, input: DriverInput, maxTicks: number): boolean {
  let prev = game.startLights();
  for (let i = 0; i < maxTicks; i++) {
    game.step(input);
    const lights = game.startLights();
    if (prev > 0 && lights === 0) return true;
    prev = lights;
  }
  return false;
}

describe('093 race game post-code gaps (thresholds and player controls)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAPS3-1: a creep under the 0.5 m threshold is not a jump start', async () => {
    const spec = loadSpec();
    spec.brakes.maxTorque = 0;
    const track = circleTrack();
    const game = await RaceGame.create(track, spec, raceConfig(0));
    try {
      const slot = gridSlots(track, 1)[0].position;
      const buf = buffers(1);
      const creep: DriverInput = { throttle: 0.05, brake: 0, steer: 0, reset: false };
      let maxMove = 0;
      for (let i = 0; i < steps(1) && maxMove < 0.15; i++) {
        game.step(creep);
        game.getStates(buf);
        maxMove = Math.max(maxMove, horiz(buf[0].position, slot));
      }
      expect(maxMove, 'the player really crept').toBeGreaterThan(0.05);
      expect(maxMove, 'the creep stays under the 0.5 m threshold').toBeLessThan(0.5);
      expect(penaltyOf(game, 0), 'no jump-start penalty').toBe(0);
      expect(game.startLights(), 'still before go').toBeLessThan(5);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS3-2: the player overtake input reaches a hybrid car after go', async () => {
    const game = await RaceGame.create(loadTrack(), loadHybridSpec(), raceConfig(0, { carId: 'ow26' }));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(1);
      let speed = 0;
      for (let i = 0; i < steps(8); i++) {
        game.step({ throttle: 1, brake: 0, steer: 0, reset: false });
        speed = game.getStates(buf)[0].forwardSpeed;
        if (speed >= 15) break;
      }
      expect(speed, 'the hybrid is above the ERS min speed').toBeGreaterThan(14);
      const tel = game.getTelemetry();
      expect(tel.ers, 'the hybrid ERS is live in a race').toBeDefined();
      game.step({ throttle: 1, brake: 0, steer: 0, reset: false, overtake: true });
      game.step({ throttle: 1, brake: 0, steer: 0, reset: false, overtake: true });
      expect(game.getTelemetry().ers?.overtake, 'overtake input reaches the car').toBe(true);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS3-3: the player ersCycle input cycles the ERS mode after go', async () => {
    const game = await RaceGame.create(circleTrack(), loadHybridSpec(), raceConfig(0, { carId: 'ow26' }));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      expect(game.getTelemetry().ers?.mode, 'initial ERS mode').toBe('balance');
      game.step({ throttle: 0, brake: 0, steer: 0, reset: false, ersCycle: true });
      expect(game.getTelemetry().ers?.mode, 'one ersCycle pulse advances the mode').toBe('attack');
      game.step({ throttle: 0, brake: 0, steer: 0, reset: false, ersCycle: false });
      game.step({ throttle: 0, brake: 0, steer: 0, reset: false, ersCycle: true });
      expect(game.getTelemetry().ers?.mode, 'the next pulse advances again').toBe('charge');
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAPS3-4: non-finite laps never finish the race and never throw', async () => {
    const track = circleTrack();
    const spec = loadSpec();
    for (const laps of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const game = await RaceGame.create(track, spec, raceConfig(0, { laps }));
      try {
        expect(stepUntilGo(game, IDLE, steps(10)), `laps ${laps}`).toBe(true);
        for (let i = 0; i < steps(3); i++) game.step(IDLE);
        expect(game.raceFinished, `laps ${laps} unfinished`).toBe(false);
        const row = game.standings()[0];
        expect(row.finished, `laps ${laps} row`).toBe(false);
        expect(Number.isFinite(row.lap), `laps ${laps} lap counter`).toBe(true);
        expect(game.config.laps, `laps ${laps} kept on config`).toBe(laps);
      } finally {
        game.dispose();
      }
    }
  }, 120000);
});

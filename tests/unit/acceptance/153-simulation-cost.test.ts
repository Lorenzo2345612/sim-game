import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { Standing } from '../../../src/race/classification';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const TOL = 1e-9;
const WARMUP_TICKS = 120;
const MEASURE_CHUNK = 50;
const MEASURE_TICKS = 600;
const SINGLE_CAR_RATIO = 12;
const MAX_HEAP_GROWTH_BYTES = 1e6;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

// Interleaved 16-car and single-car runs so both see the same host load.
async function interleavedMeans(
  track: TrackDataV2,
  spec: CarSpec,
): Promise<{ mean16: number; meanSingle: number }> {
  const many = await RaceGame.create(track, spec, raceConfig(15));
  const single = await RaceGame.create(track, spec, raceConfig(0));
  try {
    for (let i = 0; i < WARMUP_TICKS; i++) {
      many.step(IDLE);
      single.step(IDLE);
    }
    let tMany = 0;
    let tSingle = 0;
    for (let done = 0; done < MEASURE_TICKS; done += MEASURE_CHUNK) {
      let t0 = performance.now();
      for (let i = 0; i < MEASURE_CHUNK; i++) many.step(IDLE);
      tMany += performance.now() - t0;
      t0 = performance.now();
      for (let i = 0; i < MEASURE_CHUNK; i++) single.step(IDLE);
      tSingle += performance.now() - t0;
    }
    return { mean16: tMany / MEASURE_TICKS, meanSingle: tSingle / MEASURE_TICKS };
  } finally {
    many.dispose();
    single.dispose();
  }
}

function heapUsed(): number {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

function expectClose(a: number, b: number, label: string): void {
  expect(Math.abs(a - b), label).toBeLessThanOrEqual(TOL);
}

function expectCloseOpt(a: number | null, b: number | null, label: string): void {
  if (a === null || b === null) expect(a, label).toBe(b);
  else expectClose(a, b, label);
}

function expectSameStanding(a: Standing, b: Standing): void {
  expect(a.car, 'car').toBe(b.car);
  expect(a.position, 'position').toBe(b.position);
  expect(a.lap, 'lap').toBe(b.lap);
  expect(a.finished, 'finished').toBe(b.finished);
  expectClose(a.distance, b.distance, 'distance');
  expectClose(a.penalty, b.penalty, 'penalty');
  expectCloseOpt(a.totalTime, b.totalTime, 'totalTime');
  expectCloseOpt(a.gapToLeader, b.gapToLeader, 'gapToLeader');
  expectCloseOpt(a.lastLap, b.lastLap, 'lastLap');
  expectCloseOpt(a.bestLap, b.bestLap, 'bestLap');
}

interface Snapshot {
  standings: Standing[];
  positions: Array<{ x: number; y: number; z: number }>;
}

async function runSnapshot(
  track: TrackDataV2,
  spec: CarSpec,
  config: RaceConfig,
  seconds: number,
): Promise<Snapshot> {
  const game = await RaceGame.create(track, spec, config);
  try {
    for (let i = 0; i < steps(seconds); i++) game.step(IDLE);
    const states = game.getStates(buffers(game.carCount));
    return {
      standings: game.standings().map((s: Standing) => ({ ...s })),
      positions: states.map((s: VehicleState) => ({
        x: s.position.x,
        y: s.position.y,
        z: s.position.z,
      })),
    };
  } finally {
    game.dispose();
  }
}

describe('153 simulation cost acceptance', () => {
  it(
    'AT1: 600 ticks with 15 AI average ≤ 12× the interleaved single-car tick',
    async () => {
      const { mean16, meanSingle } = await interleavedMeans(loadTrack(), loadSpec());
      expect(mean16, '16-car mean vs single-car mean').toBeLessThanOrEqual(
        SINGLE_CAR_RATIO * meanSingle,
      );
    },
    300000,
  );

  it(
    'AT2: after 120 warm-up ticks, heap growth over 600 ticks with 15 AI is < 1 MB',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(15));
      try {
        for (let i = 0; i < WARMUP_TICKS; i++) game.step(IDLE);
        const before = heapUsed();
        for (let i = 0; i < MEASURE_TICKS; i++) game.step(IDLE);
        const after = heapUsed();
        expect(after - before, 'heap growth bytes').toBeLessThan(MAX_HEAP_GROWTH_BYTES);
      } finally {
        game.dispose();
      }
    },
    300000,
  );

  it(
    'AT3: two runs with seed 1 give identical standings and positions (± 1e-9)',
    async () => {
      const track = loadTrack();
      const spec = loadSpec();
      const a = await runSnapshot(track, spec, raceConfig(5), 30);
      const b = await runSnapshot(track, spec, raceConfig(5), 30);
      expect(a.standings.length, 'standing count').toBe(b.standings.length);
      for (let i = 0; i < a.standings.length; i++) expectSameStanding(a.standings[i], b.standings[i]);
      expect(a.positions.length, 'car count').toBe(b.positions.length);
      for (let i = 0; i < a.positions.length; i++) {
        expectClose(a.positions[i].x, b.positions[i].x, `car ${i} x`);
        expectClose(a.positions[i].y, b.positions[i].y, `car ${i} y`);
        expectClose(a.positions[i].z, b.positions[i].z, `car ${i} z`);
      }
    },
    180000,
  );
});

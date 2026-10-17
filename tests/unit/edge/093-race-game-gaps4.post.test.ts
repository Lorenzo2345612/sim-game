import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics } from '../../../src/physics/physicsWorld';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const RESET: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true };
const N = 72;
const R = 50;
const TARGET_SPEED = 12;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
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
    elevation: new Array<number>(N).fill(1.5),
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

function posOf(s: VehicleState): { x: number; y: number; z: number } {
  return { x: s.position.x, y: s.position.y, z: s.position.z };
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function yawOf(s: VehicleState): number {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(-fx, -fz);
}

function nearestIndex(track: TrackDataV2, x: number, z: number): number {
  const cl = track.centerline;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const d = (x - cl[i][0]) * (x - cl[i][0]) + (z - cl[i][1]) * (z - cl[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function targetAhead(track: TrackDataV2, x: number, z: number, meters: number): [number, number] {
  const cl = track.centerline;
  const n = cl.length;
  let i = nearestIndex(track, x, z);
  let acc = 0;
  while (acc < meters) {
    const a = cl[i];
    const b = cl[(i + 1) % n];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
    i = (i + 1) % n;
  }
  return cl[i];
}

function controller(track: TrackDataV2, s: VehicleState): DriverInput {
  const [tx, tz] = targetAhead(track, s.position.x, s.position.z, 18);
  const des = Math.atan2(-(tx - s.position.x), -(tz - s.position.z));
  let err = des - yawOf(s);
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const speed = s.forwardSpeed;
  return {
    throttle: speed < TARGET_SPEED ? 1 : 0.25,
    brake: speed > TARGET_SPEED + 3 ? 0.35 : 0,
    steer: Math.max(-1, Math.min(1, -1.8 * err)),
    reset: false,
  };
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

function isFiniteState(s: VehicleState): boolean {
  const r = s.rotation;
  return (
    Number.isFinite(s.position.x) &&
    Number.isFinite(s.position.y) &&
    Number.isFinite(s.position.z) &&
    Number.isFinite(r.x + r.y + r.z + r.w) &&
    Number.isFinite(s.forwardSpeed)
  );
}

describe('093 race game post-code gaps (race end and player reset)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAPS4-1: the race stays unfinished until every car has finished', async () => {
    const track = circleTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1, { laps: 1 }));
    try {
      const buf = buffers(2);
      let sawFirstFinish = false;
      for (let i = 0; i < 30000 && !game.raceFinished; i++) {
        game.getStates(buf);
        game.step(controller(track, buf[0]));
        const rows = game.standings();
        const finishedCount = rows.filter((r) => r.finished).length;
        if (!sawFirstFinish && finishedCount > 0) {
          sawFirstFinish = true;
          expect(finishedCount, 'the first finisher does not end the race').toBeLessThan(2);
          expect(game.raceFinished, 'raceFinished waits for the trailing car').toBe(false);
        }
      }
      expect(sawFirstFinish, 'one car finished within the budget').toBe(true);
      expect(game.raceFinished, 'the race ends when the last car finishes').toBe(true);
      for (const r of game.standings()) expect(r.finished, `car ${r.car} finished`).toBe(true);
    } finally {
      game.dispose();
    }
  }, 240000);

  it('GAPS4-2: a player reset input never teleports the car', async () => {
    const track = circleTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(0, { laps: 1 }));
    try {
      const buf = buffers(1);
      game.getStates(buf);
      const slot = posOf(buf[0]);
      for (let i = 0; i < 5; i++) game.step(RESET);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot), 'reset before go keeps the car on its slot').toBeLessThan(0.5);

      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      for (let i = 0; i < steps(3); i++) {
        game.getStates(buf);
        game.step(controller(track, buf[0]));
      }
      game.getStates(buf);
      const before = posOf(buf[0]);
      game.step(RESET);
      game.getStates(buf);
      expect(horiz(buf[0].position, before), 'reset after go does not respawn the player').toBeLessThan(1);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAPS4-3: fractional laps never throw and never corrupt the race', async () => {
    for (const laps of [1.5, 2.9, 0.5]) {
      const game = await RaceGame.create(circleTrack(), loadSpec(), raceConfig(0, { laps }));
      try {
        expect(stepUntilGo(game, IDLE, steps(10)), `laps ${laps}`).toBe(true);
        for (let i = 0; i < steps(3); i++) game.step(IDLE);
        const buf = buffers(1);
        game.getStates(buf);
        expect(isFiniteState(buf[0]), `laps ${laps} finite`).toBe(true);
        expect(game.raceFinished, `laps ${laps} unfinished`).toBe(false);
        expect(Number.isFinite(game.standings()[0].lap), `laps ${laps} lap counter`).toBe(true);
        expect(game.config.laps, `laps ${laps} kept on config`).toBe(laps);
      } finally {
        game.dispose();
      }
    }
  }, 180000);
});

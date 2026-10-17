import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { VehicleModel } from '../../../src/physics/vehicleModel';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const TOL = 1e-9;

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number, over: Partial<RaceConfig> = {}): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1, ...over };
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function expectClose(a: number, b: number, label: string): void {
  expect(Math.abs(a - b), label).toBeLessThanOrEqual(TOL);
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function posOf(s: VehicleState): { x: number; y: number; z: number } {
  return { x: s.position.x, y: s.position.y, z: s.position.z };
}

function samePos(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

// Lights rise 1..5 then clear to 0 at 'go'; the first 0 after a non-zero is go.
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

function distToCenterline(track: TrackDataV2, x: number, z: number): number {
  const cl = track.centerline;
  let best = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const a = cl[i];
    const b = cl[(i + 1) % cl.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    let t = 0;
    if (len2 > 0) t = Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const d = Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
    if (d < best) best = d;
  }
  return best;
}

interface CarRun {
  path: number;
  x: number;
  y: number;
  z: number;
}

async function runCar(over: Partial<RaceConfig>, car: number, seconds: number): Promise<CarRun> {
  const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1, over));
  try {
    const buf = buffers(2);
    game.getStates(buf);
    let p = posOf(buf[car]);
    let path = 0;
    for (let i = 0; i < steps(seconds); i++) {
      game.step(IDLE);
      game.getStates(buf);
      const n = posOf(buf[car]);
      path += Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z);
      p = n;
    }
    return { path, x: p.x, y: p.y, z: p.z };
  } finally {
    game.dispose();
  }
}

describe('093 race game edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('EDGE1: aiCount is clamped to 0..15 and carCount is clamp + 1', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const cases: Array<[number, number]> = [
      [-5, 1],
      [0, 1],
      [15, 16],
      [100, 16],
    ];
    for (const [aiCount, carCount] of cases) {
      const game = await RaceGame.create(track, spec, raceConfig(aiCount));
      try {
        expect(game.carCount, `aiCount ${aiCount}`).toBe(carCount);
        expect(game.getStates(buffers(game.carCount)).length).toBe(carCount);
      } finally {
        game.dispose();
      }
    }
  }, 120000);

  it('EDGE2: step after dispose throws', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(0));
    game.dispose();
    expect(() => game.step(IDLE)).toThrow();
  }, 60000);

  it('EDGE3: getStates writes into the caller reused state objects', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(2));
    try {
      const out = buffers(3);
      const ids = out.map((s) => s);
      const before = out.map((s) => posOf(s));
      const first = game.getStates(out);
      expect(first.length).toBe(3);
      for (let i = 0; i < 3; i++) expect(out[i], `car ${i} object`).toBe(ids[i]);
      expect(out.some((s, i) => !samePos(s.position, before[i])), 'out filled in place').toBe(true);
      game.step(IDLE);
      game.getStates(out);
      for (let i = 0; i < 3; i++) expect(out[i], `car ${i} object after step`).toBe(ids[i]);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE4: getPrevStates is the state before the last step', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      const buf = buffers(2);
      for (let i = 0; i < steps(15); i++) game.step(IDLE);
      game.getStates(buf);
      const snap = buf.map((s) => ({
        x: s.position.x,
        y: s.position.y,
        z: s.position.z,
        speed: s.forwardSpeed,
        qw: s.rotation.w,
      }));
      game.step(IDLE);
      const prev = game.getPrevStates();
      const cur = game.getStates(buffers(2));
      expect(prev.length).toBe(2);
      for (let i = 0; i < 2; i++) {
        expectClose(prev[i].position.x, snap[i].x, `car ${i} prev x`);
        expectClose(prev[i].position.y, snap[i].y, `car ${i} prev y`);
        expectClose(prev[i].position.z, snap[i].z, `car ${i} prev z`);
        expectClose(prev[i].forwardSpeed, snap[i].speed, `car ${i} prev speed`);
        expectClose(prev[i].rotation.w, snap[i].qw, `car ${i} prev qw`);
      }
      const moved = Math.hypot(
        cur[1].position.x - prev[1].position.x,
        cur[1].position.y - prev[1].position.y,
        cur[1].position.z - prev[1].position.z,
      );
      expect(moved, 'AI moved within one step so prev != current').toBeGreaterThan(1e-4);
      for (let i = 0; i < 2; i++) expect(game.getPrevStates()[i], `car ${i} prev object`).toBe(prev[i]);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE5: standings at go follow the grid order with the player last', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(5));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      for (let i = 0; i < steps(0.5); i++) game.step(IDLE);
      const cars = game.standings().map((s: { car: number }) => s.car);
      expect(cars).toEqual([1, 2, 3, 4, 5, 0]);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE6: the player is never reset by the stuck-car rule', async () => {
    const track = loadTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(0));
    try {
      const buf = buffers(1);
      game.getStates(buf);
      let p = posOf(buf[0]);
      let maxJump = 0;
      for (let i = 0; i < steps(20); i++) {
        game.step(IDLE);
        game.getStates(buf);
        maxJump = Math.max(maxJump, horiz(buf[0].position, p));
        p = posOf(buf[0]);
      }
      expect(maxJump, 'no per-tick teleport of the player').toBeLessThan(1);
      expect(distToCenterline(track, p.x, p.z), 'player stays off the centerline').toBeGreaterThan(1.5);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE7: cars are held before go and released at go', async () => {
    const track = loadTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(0));
    try {
      const slot = gridSlots(track, 1)[0].position;
      const buf = buffers(1);
      for (let i = 0; i < steps(5); i++) game.step(FULL);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot), 'held on the grid slot before go').toBeLessThanOrEqual(0.5);
      expect(stepUntilGo(game, FULL, steps(4.5))).toBe(true);
      for (let i = 0; i < steps(3); i++) game.step(FULL);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot), 'released at go').toBeGreaterThan(5);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE9: different seeds give different results', async () => {
    const a = await runCar({ seed: 1 }, 1, 15);
    const b = await runCar({ seed: 2 }, 1, 15);
    const differs =
      Math.abs(a.x - b.x) > TOL || Math.abs(a.y - b.y) > TOL || Math.abs(a.z - b.z) > TOL;
    expect(differs, 'seed 1 and seed 2 must diverge').toBe(true);
  }, 120000);

  it('EDGE10: chassis colliders collide with each other', async () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const a = new VehicleModel(world, spec, { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 });
      const b = new VehicleModel(world, spec, { position: { x: 0, y: 0.6, z: -12 }, yaw: 0 });
      const sa = createVehicleState(4);
      const sb = createVehicleState(4);
      const brakeFull: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
      let minD = Infinity;
      for (let i = 0; i < steps(4); i++) {
        a.setInput(FULL);
        a.prePhysicsStep(FIXED_DT);
        b.setInput(brakeFull);
        b.prePhysicsStep(FIXED_DT);
        world.step();
        a.getState(sa);
        b.getState(sb);
        expect(Number.isFinite(sa.position.x + sa.position.y + sa.position.z)).toBe(true);
        expect(Number.isFinite(sb.position.x + sb.position.y + sb.position.z)).toBe(true);
        minD = Math.min(minD, horiz(sa.position, sb.position));
      }
      expect(minD, 'chassis centers never interpenetrate').toBeGreaterThanOrEqual(2);
      expect(-sb.position.z - 12, 'struck car is shoved forward').toBeGreaterThan(1);
    } finally {
      world.free();
    }
  }, 60000);
});

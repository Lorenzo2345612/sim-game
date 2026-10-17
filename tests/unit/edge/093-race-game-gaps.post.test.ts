import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { REVERSE_HOLD_S } from '../../../src/physics/gearbox';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
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

function raceConfig(aiCount: number, over: Partial<RaceConfig> = {}): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1, ...over };
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

function yawOf(s: VehicleState): number {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(-fx, -fz);
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

function isFiniteState(s: VehicleState): boolean {
  const r = s.rotation;
  return (
    Number.isFinite(s.position.x) &&
    Number.isFinite(s.position.y) &&
    Number.isFinite(s.position.z) &&
    Number.isFinite(r.w + r.x + r.y + r.z) &&
    Number.isFinite(s.forwardSpeed)
  );
}

async function runPositions(
  track: TrackDataV2,
  spec: CarSpec,
  config: RaceConfig,
  seconds: number,
): Promise<Array<{ x: number; y: number; z: number }>> {
  const game = await RaceGame.create(track, spec, config);
  try {
    const buf = buffers(game.carCount);
    for (let i = 0; i < steps(seconds); i++) game.step(IDLE);
    return game.getStates(buf).map(posOf);
  } finally {
    game.dispose();
  }
}

describe('093 race game post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAP1: a brake hold before go never engages reverse', async () => {
    const track = loadTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1));
    try {
      const slot = gridSlots(track, 2)[1].position;
      for (let i = 0; i < steps(REVERSE_HOLD_S) + steps(1.5); i++) game.step(BRAKE);
      expect(game.getTelemetry().gear, 'still in forward gear while waiting').toBe(1);
      const buf = buffers(2);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot), 'the held brake keeps the car on its slot').toBeLessThanOrEqual(0.5);
      expect(penaltyOf(game, 0), 'a held brake is not a jump start').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAP2: before go the player throttle passes through and the steering is ignored', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    spec.brakes.maxTorque = 0;
    const game = await RaceGame.create(track, spec, raceConfig(0));
    try {
      const buf = buffers(1);
      game.getStates(buf);
      const start = posOf(buf[0]);
      const yaw0 = yawOf(buf[0]);
      const input: DriverInput = { throttle: 1, brake: 0, steer: 1, reset: false };
      for (let i = 0; i < steps(2.5); i++) game.step(input);
      game.getStates(buf);
      const d = Math.hypot(buf[0].position.x - start.x, buf[0].position.z - start.z);
      expect(d, 'throttle is not swallowed before go').toBeGreaterThan(5);
      const dyaw = Math.abs(yawOf(buf[0]) - yaw0);
      expect(Math.min(dyaw, Math.abs(2 * Math.PI - dyaw)), 'steering is ignored').toBeLessThan(0.25);
      const lat =
        (buf[0].position.x - start.x) * Math.cos(yaw0) -
        (buf[0].position.z - start.z) * Math.sin(yaw0);
      expect(Math.abs(lat), 'the creep stays in its lane').toBeLessThan(1);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAP3: an AI car shoved before go is penalised 5 s exactly once', async () => {
    const spec = loadSpec();
    spec.brakes.maxTorque = 0;
    const game = await RaceGame.create(loadTrack(), spec, raceConfig(3));
    try {
      const buf = buffers(4);
      for (let i = 0; i < steps(5); i++) {
        game.step(FULL);
        game.getStates(buf);
      }
      const aiPenalties = [1, 2, 3].map((c) => penaltyOf(game, c));
      expect(
        aiPenalties.some((p) => p === 5),
        `at least one rammed AI gets 5 s, got ${aiPenalties.join(',')}`,
      ).toBe(true);
      for (const p of aiPenalties) expect(p % 5, 'penalties are applied in one 5 s hit').toBe(0);
      for (let i = 0; i < steps(1); i++) game.step(FULL);
      expect([1, 2, 3].map((c) => penaltyOf(game, c)).join(','), 'penalised once').toBe(
        aiPenalties.join(','),
      );
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAP4: every car is held on its grid slot through the lights with live input', async () => {
    const track = loadTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(2));
    try {
      const slots = gridSlots(track, 3);
      const input: DriverInput = { throttle: 1, brake: 0, steer: 1, reset: false };
      const buf = buffers(3);
      for (let i = 0; i < steps(3); i++) game.step(input);
      game.getStates(buf);
      for (let i = 0; i < 3; i++) {
        const slot = i === 0 ? slots[2] : slots[i - 1];
        expect(
          horiz(buf[i].position, slot.position),
          `car ${i} held on its slot`,
        ).toBeLessThanOrEqual(0.5);
        expect(penaltyOf(game, i), `car ${i} penalty`).toBe(0);
      }
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAP5: standings list every car once with positions 1..N before and after go', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(4));
    try {
      const check = (label: string): void => {
        const rows = game.standings();
        expect(rows.length, label).toBe(5);
        expect(rows.map((s) => s.car).sort((a, b) => a - b), `${label} cars`).toEqual([0, 1, 2, 3, 4]);
        expect(rows.map((s) => s.position).sort((a, b) => a - b), `${label} positions`).toEqual([
          1, 2, 3, 4, 5,
        ]);
      };
      check('before go');
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      for (let i = 0; i < steps(1); i++) game.step(IDLE);
      check('after go');
    } finally {
      game.dispose();
    }
  }, 60000);

  it('GAP6: seed 0 and a negative seed are deterministic across runs', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    for (const seed of [0, -3]) {
      const a = await runPositions(track, spec, raceConfig(2, { seed }), 4);
      const b = await runPositions(track, spec, raceConfig(2, { seed }), 4);
      for (let i = 0; i < a.length; i++) {
        expect(Math.abs(a[i].x - b[i].x), `seed ${seed} car ${i} x`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(a[i].y - b[i].y), `seed ${seed} car ${i} y`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(a[i].z - b[i].z), `seed ${seed} car ${i} z`).toBeLessThanOrEqual(1e-9);
      }
    }
  }, 120000);

  it('GAP7: two stuck AIs respawn on the centerline and the player is left alone', async () => {
    const spec = loadSpec();
    spec.engine.torqueCurve = spec.engine.torqueCurve.map(([r]) => [r, 0] as [number, number]);
    const track = loadTrack();
    const game = await RaceGame.create(track, spec, raceConfig(2));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(3);
      game.getStates(buf);
      const prev = buf.map(posOf);
      const jump = [0, 0, 0];
      for (let i = 0; i < steps(6.5); i++) {
        game.step(IDLE);
        game.getStates(buf);
        for (let c = 0; c < 3; c++) {
          jump[c] = Math.max(jump[c], horiz(buf[c].position, prev[c]));
          prev[c] = posOf(buf[c]);
        }
      }
      for (const k of [1, 2]) {
        expect(jump[k], `stuck AI ${k} is teleported back`).toBeGreaterThan(1);
        expect(
          distToCenterline(track, buf[k].position.x, buf[k].position.z),
          `AI ${k} sits on the centerline`,
        ).toBeLessThan(1);
      }
      expect(jump[0], 'the player is never teleported').toBeLessThan(1);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAP8: a full 15-AI grid runs through go with finite states and full classification', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(15));
    try {
      expect(game.carCount).toBe(16);
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(16);
      for (let i = 0; i < steps(1); i++) {
        game.step(IDLE);
        game.getStates(buf);
      }
      for (let i = 0; i < 16; i++) expect(isFiniteState(buf[i]), `car ${i} finite`).toBe(true);
      const rows = game.standings();
      expect(rows.length).toBe(16);
      expect(rows.map((s) => s.position).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 16 }, (_, i) => i + 1),
      );
    } finally {
      game.dispose();
    }
  }, 180000);
});

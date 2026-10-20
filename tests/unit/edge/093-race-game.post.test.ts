import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { AutoReverse, configureVehicle, type GameTune } from '../../../src/game/game';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { REVERSE_HOLD_S } from '../../../src/physics/gearbox';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { VehicleModel } from '../../../src/physics/vehicleModel';
import { gridSlots } from '../../../src/race/grid';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { conditionsFor } from '../../../src/track/trackConditions';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const SPAWN = { position: { x: 0, y: 0.6, z: 0 }, yaw: 0 };

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

function ticks(seconds: number): number {
  return Math.ceil(seconds / FIXED_DT);
}

function horiz(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function posOf(s: VehicleState): { x: number; y: number; z: number } {
  return { x: s.position.x, y: s.position.y, z: s.position.z };
}

function penaltyOf(game: RaceGame, car: number): number {
  return game.standings().find((s) => s.car === car)?.penalty ?? 0;
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
    const d = Math.hypot(x - cl[i][0], z - cl[i][1]);
    if (d < best) best = d;
  }
  return best;
}

// Cosine between the car's forward axis and the local centerline direction.
function headingDot(track: TrackDataV2, s: VehicleState): number {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  const cl = track.centerline;
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const d = Math.hypot(s.position.x - cl[i][0], s.position.z - cl[i][1]);
    if (d < best) {
      best = d;
      idx = i;
    }
  }
  const a = cl[idx];
  const b = cl[(idx + 1) % cl.length];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  return len > 0 ? (fx * dx + fz * dz) / len : 0;
}

describe('093 race game post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: a creeping player before go is penalised 5 s exactly once', async () => {
    const spec = loadSpec();
    spec.brakes.maxTorque = 0;
    const game = await RaceGame.create(loadTrack(), spec, raceConfig(1));
    try {
      const creep: DriverInput = { throttle: 0.15, brake: 0, steer: 0, reset: false };
      const buf = buffers(2);
      game.getStates(buf);
      const start = posOf(buf[0]);
      for (let i = 0; i < steps(4) && penaltyOf(game, 0) === 0; i++) {
        game.step(creep);
        game.getStates(buf);
      }
      expect(penaltyOf(game, 0), 'the creeping player is penalised').toBe(5);
      expect(horiz(buf[0].position, start), 'the player really moved').toBeGreaterThan(0.5);
      for (let i = 0; i < steps(2); i++) game.step(creep);
      expect(penaltyOf(game, 0), 'penalised once').toBe(5);
      expect(penaltyOf(game, 1), 'the idle AI is not penalised').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST2: vertical suspension settle before go is not a jump start', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(2));
    try {
      for (let i = 0; i < steps(3); i++) game.step(IDLE);
      for (const s of game.standings()) expect(s.penalty, `car ${s.car}`).toBe(0);
      expect(stepUntilGo(game, IDLE, steps(6))).toBe(true);
      for (let i = 0; i < steps(1); i++) game.step(IDLE);
      for (const s of game.standings()) expect(s.penalty, `car ${s.car} after go`).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST3: a stuck AI respawns on the centerline and the player is left alone', async () => {
    const spec = loadSpec();
    spec.engine.torqueCurve = spec.engine.torqueCurve.map(([r]) => [r, 0] as [number, number]);
    const track = loadTrack();
    const game = await RaceGame.create(track, spec, raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(2);
      game.getStates(buf);
      let prevP = posOf(buf[0]);
      let prevA = posOf(buf[1]);
      let jumpP = 0;
      let jumpA = 0;
      for (let i = 0; i < steps(6.5); i++) {
        game.step(IDLE);
        game.getStates(buf);
        jumpP = Math.max(jumpP, horiz(buf[0].position, prevP));
        jumpA = Math.max(jumpA, horiz(buf[1].position, prevA));
        prevP = posOf(buf[0]);
        prevA = posOf(buf[1]);
      }
      expect(jumpA, 'the stuck AI is teleported back').toBeGreaterThan(1);
      expect(jumpP, 'the player is never teleported').toBeLessThan(1);
      expect(
        distToCenterline(track, buf[1].position.x, buf[1].position.z),
        'the AI sits on the centerline',
      ).toBeLessThan(1);
      expect(
        distToCenterline(track, buf[0].position.x, buf[0].position.z),
        'the player keeps the grid offset',
      ).toBeGreaterThan(1.5);
      expect(headingDot(track, buf[1]), 'the respawn faces along the track').toBeGreaterThan(0.7);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST4: fractional and NaN aiCount are clamped without throwing', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const cases: Array<[number, number]> = [
      [Number.NaN, 1],
      [2.9, 3],
      [0.4, 1],
    ];
    for (const [aiCount, carCount] of cases) {
      const game = await RaceGame.create(track, spec, raceConfig(aiCount));
      try {
        expect(game.carCount, `aiCount ${aiCount}`).toBe(carCount);
        expect(game.config.aiCount, `config.aiCount ${aiCount}`).toBe(carCount - 1);
      } finally {
        game.dispose();
      }
    }
  }, 120000);

  it('POST5: dispose can be called twice', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(0));
    game.dispose();
    expect(() => game.dispose()).not.toThrow();
  }, 60000);

  it('POST6: getStates fills only as many entries as the buffer holds', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(2));
    try {
      for (let i = 0; i < steps(1); i++) game.step(IDLE);
      const full = game.getStates(buffers(3));
      const one = createVehicleState(4);
      const out = game.getStates([one]);
      expect(out.length).toBe(1);
      expect(out[0]).toBe(one);
      expect(Math.abs(one.position.x - full[0].position.x), 'car 0 x').toBeLessThanOrEqual(1e-9);
      expect(Math.abs(one.position.z - full[0].position.z), 'car 0 z').toBeLessThanOrEqual(1e-9);
      const empty: VehicleState[] = [];
      expect(game.getStates(empty)).toBe(empty);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST7: AutoReverse engages reverse on a held brake and leaves it on throttle', async () => {
    const world = createPhysicsWorld();
    try {
      const v = new VehicleModel(world, loadSpec(), SPAWN);
      const ar = new AutoReverse();
      for (let i = 0; i < ticks(REVERSE_HOLD_S) + 1; i++) ar.update(v, BRAKE, 0);
      expect(v.gear(), 'brake hold engages reverse').toBe(-1);
      ar.update(v, FULL, 0);
      expect(v.gear(), 'throttle leaves reverse').toBe(1);
    } finally {
      world.free();
    }
  }, 60000);

  it('POST8: AutoReverse ignores manual mode and a reset input clears the hold', async () => {
    const world = createPhysicsWorld();
    try {
      const v = new VehicleModel(world, loadSpec(), SPAWN);
      const ar = new AutoReverse();
      v.setGearMode('manual');
      for (let i = 0; i < ticks(REVERSE_HOLD_S) + 1; i++) ar.update(v, BRAKE, 0);
      expect(v.gear(), 'manual mode never auto-reverses').toBe(1);
      v.setGearMode('auto');
      const half = Math.floor(ticks(REVERSE_HOLD_S) / 2);
      for (let i = 0; i < half; i++) ar.update(v, BRAKE, 0);
      ar.update(v, { ...BRAKE, reset: true }, 0);
      for (let i = 0; i < half; i++) ar.update(v, BRAKE, 0);
      expect(v.gear(), 'reset clears the hold timer').toBe(1);
      for (let i = 0; i < ticks(REVERSE_HOLD_S) + 1; i++) ar.update(v, BRAKE, 0);
      expect(v.gear(), 'the hold works again after a reset').toBe(-1);
    } finally {
      world.free();
    }
  }, 60000);

  it('POST9: after go the player can reverse by holding the brake', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(0));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      for (let i = 0; i < ticks(REVERSE_HOLD_S) + 2; i++) game.step(BRAKE);
      expect(game.getTelemetry().gear, 'the race applies AutoReverse to the player').toBe(-1);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST10: wheel rays ignore another car chassis', async () => {
    const spec = loadSpec();
    const world = createPhysicsWorld();
    try {
      const a = new VehicleModel(world, spec, SPAWN);
      const b = new VehicleModel(world, spec, { position: { x: 0, y: 1.3, z: 0 }, yaw: 0 });
      const sa = createVehicleState(4);
      const sb = createVehicleState(4);
      for (let i = 0; i < steps(1.5); i++) {
        a.setInput(IDLE);
        a.prePhysicsStep(FIXED_DT);
        b.setInput(IDLE);
        b.prePhysicsStep(FIXED_DT);
        world.step();
        a.getState(sa);
        b.getState(sb);
        if (i >= steps(0.5)) {
          // Cars rest on each other's car-car colliders, well above the 0.08 m chassis-only offset.
          expect(sb.position.y - sa.position.y, 'the stacked car stays on top').toBeGreaterThan(0.08);
        }
      }
      const loadA = a.getTelemetry().wheels.reduce((s, w) => s + w.fz, 0);
      const loadB = b.getTelemetry().wheels.reduce((s, w) => s + w.fz, 0);
      expect(loadA, 'the bottom car is wheel-supported').toBeGreaterThan(1000);
      expect(loadB, 'the top car is not wheel-supported by the other chassis').toBeLessThan(1);
    } finally {
      world.free();
    }
  }, 60000);

  it('POST11: configureVehicle applies the tune fuel multiplier', async () => {
    const spec = loadSpec();
    const burnWith = (tune?: GameTune): number => {
      const world = createPhysicsWorld();
      try {
        const v = new VehicleModel(world, spec, SPAWN);
        configureVehicle(v, 'monza', tune);
        const start = v.getTelemetry().fuelKg;
        for (let i = 0; i < steps(8); i++) {
          v.setInput(FULL);
          v.prePhysicsStep(FIXED_DT);
          world.step();
        }
        return start - v.getTelemetry().fuelKg;
      } finally {
        world.free();
      }
    };
    const base = burnWith({ compound: 'medium', wear: 1, fuel: 1 });
    const doubled = burnWith({ compound: 'medium', wear: 1, fuel: 2 });
    expect(base, 'the car burns fuel').toBeGreaterThan(0);
    expect(doubled, 'fuel 2 burns faster than fuel 1').toBeGreaterThan(base * 1.5);
  }, 60000);

  it('POST12: configureVehicle returns the track conditions of the track', async () => {
    const world = createPhysicsWorld();
    try {
      const v = new VehicleModel(world, loadSpec(), SPAWN);
      expect(configureVehicle(v, 'monza')).toEqual(conditionsFor('monza'));
      expect(configureVehicle(v, 'monza', { compound: 'soft', wear: 2, fuel: 0.5 })).toEqual(
        conditionsFor('monza'),
      );
    } finally {
      world.free();
    }
  }, 60000);

  it('POST13: simTime advances one fixed step per tick and the race is unfinished at the start', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(0));
    try {
      expect(game.raceFinished, 'unfinished before the lights').toBe(false);
      for (let i = 0; i < 10; i++) game.step(IDLE);
      expect(game.simTime).toBeCloseTo(10 * FIXED_DT, 9);
      expect(game.raceFinished, 'still unfinished').toBe(false);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST14: a held brake before go keeps the player on its grid slot', async () => {
    const track = loadTrack();
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1));
    try {
      const slot = gridSlots(track, 2)[1].position;
      for (let i = 0; i < steps(1); i++) game.step(BRAKE);
      for (let i = 0; i < steps(2); i++) game.step(IDLE);
      const buf = buffers(2);
      game.getStates(buf);
      expect(horiz(buf[0].position, slot), 'still held on the grid').toBeLessThanOrEqual(0.5);
      for (const s of game.standings()) expect(s.penalty, `car ${s.car}`).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST15: the lights rise 1..5, hold, then clear at go', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(3));
    try {
      const seen: number[] = [];
      let go = false;
      for (let i = 0; i < steps(12) && !go; i++) {
        game.step(IDLE);
        const lights = game.startLights();
        seen.push(lights);
        if (seen.length >= 2 && seen[seen.length - 2] > 0 && lights === 0) go = true;
      }
      expect(go, 'the lights reach go within 12 s').toBe(true);
      const runs: number[] = [];
      for (const v of seen) if (runs[runs.length - 1] !== v) runs.push(v);
      expect(runs, 'dark, then 1..5, then dark at go').toEqual([0, 1, 2, 3, 4, 5, 0]);
      for (const s of game.standings()) expect(s.penalty, `car ${s.car}`).toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST16: a stuck AI is not respawned during the first 5 s after go', async () => {
    const spec = loadSpec();
    spec.engine.torqueCurve = spec.engine.torqueCurve.map(([r]) => [r, 0] as [number, number]);
    const game = await RaceGame.create(loadTrack(), spec, raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(2);
      game.getStates(buf);
      let prevP = posOf(buf[0]);
      let prevA = posOf(buf[1]);
      let jumpP = 0;
      let jumpA = 0;
      for (let i = 0; i < steps(4.5); i++) {
        game.step(IDLE);
        game.getStates(buf);
        jumpP = Math.max(jumpP, horiz(buf[0].position, prevP));
        jumpA = Math.max(jumpA, horiz(buf[1].position, prevA));
        prevP = posOf(buf[0]);
        prevA = posOf(buf[1]);
      }
      expect(jumpA, 'no AI teleport inside the 5 s window').toBeLessThan(1);
      expect(jumpP, 'no player teleport either').toBeLessThan(1);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('POST17: getStates leaves buffer entries beyond carCount untouched', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(1));
    try {
      for (let i = 0; i < steps(1); i++) game.step(IDLE);
      const tail = createVehicleState(4);
      tail.position.x = -999;
      tail.position.y = -999;
      tail.position.z = -999;
      const out = game.getStates([...buffers(2), tail]);
      expect(out.length).toBe(3);
      expect(tail.position.x).toBe(-999);
      expect(tail.position.y).toBe(-999);
      expect(tail.position.z).toBe(-999);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST18: extreme aiCount values stay clamped and never throw', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    for (const aiCount of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 15.9, -1e9, 1e9]) {
      const game = await RaceGame.create(track, spec, raceConfig(aiCount));
      try {
        expect(game.carCount, `aiCount ${aiCount} low`).toBeGreaterThanOrEqual(1);
        expect(game.carCount, `aiCount ${aiCount} high`).toBeLessThanOrEqual(16);
        expect(game.config.aiCount, `config.aiCount ${aiCount}`).toBe(game.carCount - 1);
      } finally {
        game.dispose();
      }
    }
  }, 120000);

  it('POST19: unusual player inputs are accepted and the race stays finite', async () => {
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(2));
    try {
      const buf = buffers(3);
      const weird: DriverInput = {
        throttle: Number.NaN,
        brake: 3,
        steer: -5,
        reset: true,
        shiftUp: true,
        shiftDown: true,
        overtake: true,
        ersCycle: true,
      };
      const finite = (): void => {
        game.getStates(buf);
        for (const s of buf) {
          expect(Number.isFinite(s.position.x + s.position.y + s.position.z), 'finite pos').toBe(true);
          expect(Number.isFinite(s.forwardSpeed), 'finite speed').toBe(true);
          expect(Number.isFinite(s.rotation.w + s.rotation.x + s.rotation.y + s.rotation.z), 'finite rot').toBe(true);
        }
      };
      for (let i = 0; i < steps(2); i++) {
        game.step(weird);
        finite();
      }
      expect(stepUntilGo(game, weird, steps(10))).toBe(true);
      for (let i = 0; i < steps(2); i++) {
        game.step(weird);
        finite();
      }
    } finally {
      game.dispose();
    }
  }, 60000);

  it('POST20: RaceGame.create applies the tune fuel multiplier to the player', async () => {
    const burned = async (tune?: GameTune): Promise<number> => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(0), tune);
      try {
        expect(stepUntilGo(game, FULL, steps(10))).toBe(true);
        const start = game.getTelemetry().fuelKg;
        for (let i = 0; i < steps(6); i++) game.step(FULL);
        return start - game.getTelemetry().fuelKg;
      } finally {
        game.dispose();
      }
    };
    const base = await burned();
    const doubled = await burned({ compound: 'medium', wear: 1, fuel: 2 });
    expect(base, 'the player burns fuel after go').toBeGreaterThan(0);
    expect(doubled, 'fuel 2 burns faster in a race too').toBeGreaterThan(base * 1.5);
  }, 120000);

  it('POST21: raceGame draws no unseeded randomness', () => {
    const src = readFileSync(join(ROOT, 'src/game/raceGame.ts'), 'utf8');
    expect(src.includes('Math.random'), 'no Math.random in raceGame.ts').toBe(false);
  });
});

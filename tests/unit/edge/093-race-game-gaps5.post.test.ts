import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { copyVehicleState, createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics } from '../../../src/physics/physicsWorld';

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

function deadSpec(): CarSpec {
  const spec = loadSpec();
  spec.engine.torqueCurve = spec.engine.torqueCurve.map(([r]) => [r, 0] as [number, number]);
  return spec;
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

function circleTrack(over: Partial<TrackDataV2> = {}): TrackDataV2 {
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
    ...over,
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

function yawOf(s: VehicleState): number {
  const q = s.rotation;
  const fx = -2 * (q.w * q.y + q.x * q.z);
  const fz = -1 + 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(-fx, -fz);
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

function nearestVertex(track: TrackDataV2, x: number, z: number): number {
  const cl = track.centerline;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < cl.length; i++) {
    const d = (x - cl[i][0]) ** 2 + (z - cl[i][1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function isFiniteState(s: VehicleState): boolean {
  const v = s.position;
  const q = s.rotation;
  return (
    Number.isFinite(v.x + v.y + v.z) &&
    Number.isFinite(q.x + q.y + q.z + q.w) &&
    Number.isFinite(s.forwardSpeed)
  );
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

interface RespawnEvent {
  car: number;
  state: VehicleState;
}

// Detects the teleport of a stuck car: a horizontal jump far above any per-tick motion.
function runUntilRespawns(
  game: RaceGame,
  carCount: number,
  maxTicks: number,
  wanted: number,
): RespawnEvent[] {
  const buf = buffers(carCount);
  const prev = buffers(carCount);
  game.getStates(prev);
  const found: RespawnEvent[] = [];
  for (let i = 0; i < maxTicks && found.length < wanted; i++) {
    game.step(IDLE);
    game.getStates(buf);
    for (let c = 1; c < carCount; c++) {
      if (found.some((e) => e.car === c)) continue;
      if (horiz(buf[c].position, prev[c].position) > 1) {
        const snapshot = createVehicleState(4);
        copyVehicleState(buf[c], snapshot);
        found.push({ car: c, state: snapshot });
      }
    }
    for (let c = 0; c < carCount; c++) copyVehicleState(buf[c], prev[c]);
  }
  return found;
}

describe('093 race game post-code gaps (respawn pose and config)', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('GAPS5-1: a respawned AI lands on a centerline vertex facing along the track', async () => {
    const track = circleTrack();
    const game = await RaceGame.create(track, deadSpec(), raceConfig(2));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const events = runUntilRespawns(game, 3, steps(10), 2);
      expect(events.length, 'both stuck AIs are respawned').toBe(2);
      for (const e of events) {
        const idx = nearestVertex(track, e.state.position.x, e.state.position.z);
        const p = track.centerline[idx];
        const next = track.centerline[(idx + 1) % N];
        expect(
          horiz(e.state.position, { x: p[0], z: p[1] }),
          `car ${e.car} sits on a centerline vertex`,
        ).toBeLessThan(0.5);
        const want = Math.atan2(-(next[0] - p[0]), -(next[1] - p[1]));
        expect(angleDiff(yawOf(e.state), want), `car ${e.car} faces along the track`).toBeLessThan(
          0.25,
        );
      }
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAPS5-2: a respawn on a track without elevation data lands at 0.6 m', async () => {
    const track = circleTrack({ elevation: [] });
    const game = await RaceGame.create(track, deadSpec(), raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const events = runUntilRespawns(game, 2, steps(10), 1);
      expect(events.length, 'the stuck AI is respawned').toBe(1);
      expect(events[0].state.position.y, 'missing elevation falls back to 0').toBeCloseTo(0.6, 1);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAPS5-3: a zero-width track still runs the race with finite states', async () => {
    const track = circleTrack({ widthMeters: 0 });
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(2);
      for (let i = 0; i < steps(2); i++) {
        game.step(IDLE);
        game.getStates(buf);
        for (const s of buf) expect(isFiniteState(s)).toBe(true);
      }
      const rows = game.standings();
      expect(rows.map((s) => s.position).sort((a, b) => a - b)).toEqual([1, 2]);
      expect(rows.every((s) => Number.isFinite(s.distance))).toBe(true);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAPS5-4: a zero track length falls back to a one-point lookahead', async () => {
    const track = circleTrack({ lengthMeters: 0, officialLengthMeters: 0 });
    const game = await RaceGame.create(track, loadSpec(), raceConfig(1));
    try {
      expect(stepUntilGo(game, IDLE, steps(10))).toBe(true);
      const buf = buffers(2);
      for (let i = 0; i < steps(2); i++) {
        game.step(IDLE);
        game.getStates(buf);
        for (const s of buf) expect(isFiniteState(s)).toBe(true);
      }
      expect(game.standings().length).toBe(2);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('GAPS5-5: non-finite and negative seeds never throw and stay deterministic', async () => {
    const track = circleTrack();
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5, 2 ** 32]) {
      const statesOf = async (): Promise<string> => {
        const game = await RaceGame.create(track, loadSpec(), raceConfig(2, { seed }));
        try {
          const buf = buffers(3);
          const parts: string[] = [];
          for (let i = 0; i < steps(1.5); i++) {
            game.step(IDLE);
            game.getStates(buf);
            if (i % 15 !== 0) continue;
            for (const s of buf) {
              expect(isFiniteState(s), `seed ${seed} finite`).toBe(true);
              parts.push(
                `${s.position.x},${s.position.y},${s.position.z},${s.rotation.w},${s.forwardSpeed}`,
              );
            }
          }
          return parts.join('|');
        } finally {
          game.dispose();
        }
      };
      const a = await statesOf();
      const b = await statesOf();
      expect(a, `seed ${seed} reproduces the same run`).toBe(b);
    }
  }, 180000);

  it('GAPS5-6: config keeps the request and reports the clamped aiCount', async () => {
    const track = circleTrack();
    const spec = loadSpec();
    const cases: Array<[number, number]> = [
      [99, 15],
      [-3, 0],
      [Number.NaN, 0],
    ];
    for (const [aiCount, clamped] of cases) {
      const game = await RaceGame.create(
        track,
        spec,
        raceConfig(aiCount, {
          trackId: 'cfg-track',
          carId: 'cfg-car',
          laps: 2,
          difficulty: 'hard',
          seed: 7,
        }),
      );
      try {
        expect(game.config, `aiCount ${aiCount}`).toEqual({
          trackId: 'cfg-track',
          carId: 'cfg-car',
          laps: 2,
          aiCount: clamped,
          difficulty: 'hard',
          seed: 7,
        });
        expect(game.carCount).toBe(clamped + 1);
      } finally {
        game.dispose();
      }
    }
  }, 120000);
});

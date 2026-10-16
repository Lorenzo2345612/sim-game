import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { TrackProgress } from '../../../src/track/trackProgress';
import { DEFAULT_GAME_OPTIONS, loadGameOptions, type KeyValueStorage } from '../../../src/core/settings';
import type { DriverInput, LapEvent, Quat, Surface } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const ASPHALT: Surface[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
const DEFAULTS = { wear: 1, fuel: 1, compound: 'medium' };

function storage(raw: string | null): KeyValueStorage {
  return { getItem: () => raw, setItem: () => {} };
}

function meanWear(game: Game): number {
  const t = game.getTelemetry();
  return t.wheels.reduce((s, w) => s + w.wear, 0) / t.wheels.length;
}

function fuelOf(game: Game): number {
  return game.getTelemetry().fuelKg;
}

function forwardXZ(q: Quat): [number, number] {
  const tx = 2 * (q.y * -1 - q.z * 0);
  const ty = 2 * (q.z * 0 - q.x * -1);
  const tz = 2 * (q.x * 0 - q.y * 0);
  return [
    0 + q.w * tx + (q.y * tz - q.z * ty),
    -1 + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

let game: Game | null = null;

beforeAll(async () => {
  await initPhysics();
});

afterEach(() => {
  game?.dispose();
  game = null;
  vi.restoreAllMocks();
});

describe('070 settings: stored game options', () => {
  it('EDGE9: missing, empty, corrupt or non-object entries yield the defaults', () => {
    for (const raw of [null, '', ' ', '{', 'not json', '[]', '"medium"', '3', 'null', '{"wear":}']) {
      expect(loadGameOptions(storage(raw))).toEqual(DEFAULTS);
    }
  });

  it('EDGE10: finite positive multipliers and known compounds are kept; each invalid field falls back on its own', () => {
    expect(loadGameOptions(storage(JSON.stringify({ wear: 2.5, fuel: 0.5, compound: 'hard' })))).toEqual({
      wear: 2.5,
      fuel: 0.5,
      compound: 'hard',
    });
    expect(loadGameOptions(storage(JSON.stringify({ compound: 'soft' })))).toEqual({
      wear: 1,
      fuel: 1,
      compound: 'soft',
    });
    expect(loadGameOptions(storage(JSON.stringify({ wear: 0, fuel: -3, compound: 'ultrasoft' })))).toEqual(DEFAULTS);
    expect(loadGameOptions(storage(JSON.stringify({ wear: '3', fuel: null, compound: 7 })))).toEqual(DEFAULTS);
    expect(loadGameOptions(storage(JSON.stringify({ wear: -0.001, fuel: 0 })))).toEqual(DEFAULTS);
  });

  it('EDGE11: the numeric limits are finite and strictly positive on both ends', () => {
    expect(loadGameOptions(storage('{"wear":1e308,"fuel":1e-308}'))).toEqual({
      wear: 1e308,
      fuel: 1e-308,
      compound: 'medium',
    });
    expect(loadGameOptions(storage('{"wear":1e999,"fuel":0}'))).toEqual(DEFAULTS);
  });

  it('EDGE12: a storage that throws yields the defaults instead of propagating', () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {},
    };
    expect(loadGameOptions(blocked)).toEqual(DEFAULTS);
  });

  it('EDGE13: the returned options are a fresh copy, never the shared default object', () => {
    const first = loadGameOptions(storage(null));
    first.wear = 9;
    first.compound = 'hard';
    expect(loadGameOptions(storage(null))).toEqual(DEFAULTS);
    expect(DEFAULT_GAME_OPTIONS).toEqual(DEFAULTS);
  });

  it('EDGE14: ?wear=/?fuel= keep the stored option when absent and fall back to 1 for non-finite or non-positive values', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/main.ts', import.meta.url)), 'utf8');
    const m = src.match(/function queryMultiplier\([^)]*\):[^{]*\{[\s\S]{0,400}?\n\}/);
    expect(m).not.toBeNull();
    const body = m![0];
    expect(body).toMatch(/raw === null/);
    expect(body).toMatch(/Number\.isFinite/);
    expect(body).toMatch(/n > 0/);
    expect(body).toMatch(/\?\s*n\s*:\s*1\b/);
  });

  it('EDGE23: a preset-only settings entry on the shared key yields the defaults, keeping any valid field', () => {
    expect(loadGameOptions(storage(JSON.stringify({ preset: 'high' })))).toEqual(DEFAULTS);
    expect(loadGameOptions(storage(JSON.stringify({ preset: 'low', wear: 2 })))).toEqual({
      wear: 2,
      fuel: 1,
      compound: 'medium',
    });
  });

});

describe('070 game: tune wiring', () => {
  it('EDGE15: an explicit medium/1/1 tune drives exactly like creating the game without a tune', async () => {
    const plain = await Game.create(circleTrack);
    const tuned = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 1, fuel: 1 });
    try {
      for (let i = 0; i < 360; i++) {
        plain.step(FULL);
        tuned.step(FULL);
      }
      const a = plain.getTelemetry();
      const b = tuned.getTelemetry();
      expect(b.fuelKg).toBeCloseTo(a.fuelKg, 12);
      for (let i = 0; i < 4; i++) expect(b.wheels[i].wear).toBeCloseTo(a.wheels[i].wear, 12);
    } finally {
      plain.dispose();
      tuned.dispose();
    }
  }, 60000);

  it('EDGE16: tune wear=5 burns 4 to 6 times the wear of wear=1 over 6 s of full throttle', async () => {
    const one = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 1, fuel: 1 });
    const five = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 5, fuel: 1 });
    try {
      for (let i = 0; i < 720; i++) {
        one.step(FULL);
        five.step(FULL);
      }
      const w1 = meanWear(one);
      const w5 = meanWear(five);
      expect(w1).toBeGreaterThan(0);
      const ratio = w5 / w1;
      expect(ratio).toBeGreaterThanOrEqual(4);
      expect(ratio).toBeLessThanOrEqual(6);
    } finally {
      one.dispose();
      five.dispose();
    }
  }, 60000);

  it('EDGE17: tune fuel=2 burns twice the fuel of fuel=1 over the same driving', async () => {
    const one = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 1, fuel: 1 });
    const two = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 1, fuel: 2 });
    try {
      const start1 = fuelOf(one);
      const start2 = fuelOf(two);
      for (let i = 0; i < 360; i++) {
        one.step(FULL);
        two.step(FULL);
      }
      const burnt1 = start1 - fuelOf(one);
      const burnt2 = start2 - fuelOf(two);
      expect(burnt1).toBeGreaterThan(0);
      expect(burnt2 / burnt1).toBeCloseTo(2, 1);
    } finally {
      one.dispose();
      two.dispose();
    }
  }, 60000);

  it('EDGE18: tune compound=soft wears the tyres clearly faster than compound=hard', async () => {
    const soft = await Game.create(circleTrack, undefined, { compound: 'soft', wear: 1, fuel: 1 });
    const hard = await Game.create(circleTrack, undefined, { compound: 'hard', wear: 1, fuel: 1 });
    try {
      for (let i = 0; i < 720; i++) {
        soft.step(FULL);
        hard.step(FULL);
      }
      const ws = meanWear(soft);
      const wh = meanWear(hard);
      expect(ws).toBeGreaterThan(0);
      expect(ws).toBeGreaterThan(wh * 1.5);
      expect(Number.isFinite(wh)).toBe(true);
    } finally {
      soft.dispose();
      hard.dispose();
    }
  }, 60000);

  it('EDGE21: a tune with zero, negative or non-finite multipliers drives exactly like the defaults', async () => {
    const plain = await Game.create(circleTrack);
    const zero = await Game.create(circleTrack, undefined, { compound: 'medium', wear: 0, fuel: -1 });
    const bad = await Game.create(circleTrack, undefined, {
      compound: 'medium',
      wear: Number.NaN,
      fuel: Number.POSITIVE_INFINITY,
    });
    const runs = [plain, zero, bad];
    try {
      for (let i = 0; i < 360; i++) for (const g of runs) g.step(FULL);
      const base = plain.getTelemetry();
      expect(base.fuelKg).toBeGreaterThan(0);
      for (const g of [zero, bad]) {
        const t = g.getTelemetry();
        expect(t.fuelKg).toBeCloseTo(base.fuelKg, 12);
        for (let i = 0; i < 4; i++) expect(t.wheels[i].wear).toBeCloseTo(base.wheels[i].wear, 12);
      }
    } finally {
      for (const g of runs) g.dispose();
    }
  }, 60000);

  it('EDGE22: telemetry is a 4-wheel finite record while idle and over a 30 s full-throttle run', async () => {
    game = await Game.create(circleTrack);
    const check = (): void => {
      const t = game!.getTelemetry();
      expect(t.wheels).toHaveLength(4);
      for (const w of t.wheels) {
        expect(Number.isFinite(w.fz)).toBe(true);
        expect(Number.isFinite(w.kappa)).toBe(true);
        expect(Number.isFinite(w.alpha)).toBe(true);
        expect(Number.isFinite(w.tempC)).toBe(true);
        expect(Number.isFinite(w.wear)).toBe(true);
        expect(w.wear).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isFinite(t.fuelKg)).toBe(true);
      expect(t.fuelKg).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(t.rpm)).toBe(true);
      expect(Number.isFinite(t.gear)).toBe(true);
      expect(Number.isInteger(t.gear)).toBe(true);
      expect(Number.isFinite(game!.heading())).toBe(true);
    };
    check();
    const fuel0 = fuelOf(game);
    for (let i = 0; i < 3600; i++) {
      game.step(FULL);
      if (i % 600 === 599) check();
    }
    expect(fuelOf(game)).toBeLessThan(fuel0);
  }, 60000);

});

describe('070 game: per-lap fuel and heading', () => {
  it('EDGE19: meanLapFuel is null until a lap completes, then the mean of the fuel burnt on each completed lap', async () => {
    game = await Game.create(circleTrack);
    vi.spyOn(Vehicle.prototype, 'getWheelSurfaces').mockImplementation(() => ASPHALT);
    // Scripted track distances (circleTrack laps 628.3 m, sectors at ~209.4 and ~418.9).
    let dist = 0;
    vi.spyOn(TrackProgress.prototype, 'update').mockImplementation(() => ({ index: 0, distance: dist, lateral: 0 }));
    const stepAt = (d: number, input: DriverInput = IDLE): LapEvent[] => {
      dist = d;
      game!.step(input);
      return game!.drainEvents();
    };

    expect(game.meanLapFuel()).toBeNull();
    stepAt(580);
    expect(stepAt(10).some((e) => e.type === 'lapStarted')).toBe(true);
    expect(game.meanLapFuel()).toBeNull();

    const fuelLap1Start = fuelOf(game);
    for (let i = 0; i < 240; i++) stepAt(300, FULL); // first step crosses sector 1
    stepAt(500); // sector 2
    stepAt(580);
    expect(stepAt(10).some((e) => e.type === 'lapCompleted')).toBe(true);
    const burn1 = fuelLap1Start - fuelOf(game);
    expect(burn1).toBeGreaterThan(0);
    expect(game.meanLapFuel()).toBeCloseTo(burn1, 12);

    const fuelLap2Start = fuelOf(game);
    for (let i = 0; i < 240; i++) stepAt(300, FULL);
    stepAt(500);
    stepAt(580);
    expect(stepAt(10).some((e) => e.type === 'lapCompleted')).toBe(true);
    const burn2 = fuelLap2Start - fuelOf(game);
    expect(burn2).toBeGreaterThan(0);
    expect(game.meanLapFuel()).toBeCloseTo((burn1 + burn2) / 2, 12);
  }, 60000);

  it('EDGE20: heading() is the pose yaw: matches the spawn yaw and the horizontal forward direction', async () => {
    game = await Game.create(circleTrack);
    const spawn = spawnFromTrack(circleTrack);
    expect(game.heading()).toBeCloseTo(spawn.yaw, 7);

    // Heading must point along the horizontal forward: compare directions (the
    // horizontal projection is slightly shorter than 1 when the car is pitched).
    const forward = (maxRad: number): void => {
      const [fx, fz] = forwardXZ(game!.getCurrentState().rotation);
      const h = game!.heading();
      const n = Math.hypot(fx, fz);
      const cos = (-Math.sin(h) * fx - Math.cos(h) * fz) / n;
      expect(Math.acos(Math.min(1, Math.max(-1, cos)))).toBeLessThan(maxRad);
    };
    forward(1e-6);

    for (let i = 0; i < 360; i++) {
      game.step(i < 300 ? FULL : { throttle: 1, brake: 0, steer: 0.5, reset: false });
      const h = game.heading();
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThanOrEqual(Math.PI);
    }
    expect(game.getCurrentState().forwardSpeed).toBeGreaterThan(0);
    forward(1e-5);
  }, 60000);
});

describe('070 main wiring: query multipliers and restart', () => {
  it('EDGE24: queryMultiplier keeps the stored value when absent, overrides with valid input and falls back to 1 otherwise', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/main.ts', import.meta.url)), 'utf8');
    const m = src.match(/function queryMultiplier\([^)]*\):[^{]*\{([\s\S]{0,400}?\n)\}/);
    expect(m).not.toBeNull();
    const fn = new Function('raw', 'stored', m![1]) as (raw: string | null, stored: number) => number;
    expect(fn(null, 7)).toBe(7);
    expect(fn('5', 7)).toBe(5);
    expect(fn('0.5', 7)).toBe(0.5);
    expect(fn(' 4 ', 7)).toBe(4);
    for (const raw of ['', '   ', '0', '-3', 'abc', 'NaN', 'Infinity', '-Infinity', '1e999', 'true']) {
      expect(fn(raw, 7)).toBe(1);
    }
  });

  it('EDGE25: restart rebuilds the Game from the fresh setup with the boot tune', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/main.ts', import.meta.url)), 'utf8');
    const i = src.search(/const\s+restart\s*=/);
    expect(i).toBeGreaterThanOrEqual(0);
    const ends = ['changeTrack', 'showPauseMenu', 'onKeydown']
      .map((n) => src.indexOf(n, i))
      .filter((k) => k > i);
    const body = src.slice(i, ends.length ? Math.min(...ends) : i + 2500);
    expect(body).toMatch(/Game\.create\(\s*track\s*,/);
    expect(body).toMatch(/freshSpec\s*\(|loadSetup\s*\(|applySetup\s*\(/);
    expect(body).toMatch(/Game\.create\([\s\S]{0,160}\btune\b/);
  });
});

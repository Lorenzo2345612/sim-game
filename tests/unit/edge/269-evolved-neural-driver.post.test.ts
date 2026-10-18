import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { N_IN, N_W, parseNeuralModel } from '../../../src/ai/neuralPolicy';
import { NeuralFeatures, racingTargetPoints, type NeuralCarState } from '../../../src/ai/neuralFeatures';
import { NeuralDriver } from '../../../src/ai/neuralDriver';
import { RaceGame, type RaceConfig, type RaceGameOptions } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function makeState(over: Partial<NeuralCarState> = {}): NeuralCarState {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 0,
    linvel: { x: 0, y: 0, z: 0 },
    angvel: { x: 0, y: 0, z: 0 },
    progress: { index: 0, distance: 0, lateral: 0 },
    fuelMassKg: 0,
    compoundGrip: 0,
    others: [],
    ...over,
  };
}

// Straight 200 m centerline along -Z, 21 points every 10 m.
const STRAIGHT: [number, number][] = Array.from({ length: 21 }, (_, i): [number, number] => [0, -10 * i]);
const HW_L8: number[] = new Array(21).fill(8);
const HW_R12: number[] = new Array(21).fill(12);

// 200 m x 100 m rectangle, 60 points (same layout as the pre-code edge tests).
const RECT: [number, number][] = [];
for (let k = 0; k <= 20; k++) RECT.push([0, -10 * k]);
for (let k = 1; k <= 10; k++) RECT.push([10 * k, -200]);
for (let k = 1; k <= 20; k++) RECT.push([100, -200 + 10 * k]);
for (let k = 1; k <= 9; k++) RECT.push([100 - 10 * k, 0]);
const RECT_HW: number[] = new Array(RECT.length).fill(10);

function other(
  x: number,
  z: number,
  linvel: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { position: { x: number; y: number; z: number }; linvel: { x: number; y: number; z: number } } {
  return { position: { x, y: 0, z }, linvel };
}

describe('269 evolved neural driver post-code gaps', () => {
  it('POST1: mintimeSpeed overrides the computed profile with min(90, v * 0.97)', () => {
    const mt50 = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12, {
      points: STRAIGHT,
      mintimeSpeed: new Array(21).fill(50),
    });
    expect(mt50.speedAt(0)).toBeCloseTo(48.5, 12);
    expect(mt50.speedAt(20)).toBeCloseTo(48.5, 12);
    const out = new Float64Array(N_IN);
    mt50.fill(out, makeState({ forwardSpeed: 0 }));
    expect(out[15]).toBeCloseTo(48.5 / 60, 12);
    expect(out[13]).toBeCloseTo(-3, 12); // (0 - 48.5) / 10 clamped
    const mt200 = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12, {
      points: STRAIGHT,
      mintimeSpeed: new Array(21).fill(200),
    });
    expect(mt200.speedAt(0)).toBeCloseTo(90, 12); // capped
  });

  it('POST2: a racing target line drives the speed profile instead of the centerline', () => {
    const zig: [number, number][] = STRAIGHT.map(([, z], i): [number, number] => [4 * Math.sin(i), z]);
    const center = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const racing = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12, { points: zig });
    expect(center.speedAt(0)).toBeCloseTo(90, 12);
    expect(racing.speedAt(10), 'zigzag profile slower than straight').toBeLessThan(90);
    expect(racing.speedAt(10)).toBeGreaterThan(0);
  });

  it('POST3: racingTargetPoints keeps the length and clamps inside the edges with a 1 m margin', () => {
    const pts = racingTargetPoints(RECT, 20, RECT_HW, RECT_HW);
    expect(pts.length).toBe(RECT.length);
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - RECT[i][0], pts[i][1] - RECT[i][1]);
      expect(Number.isFinite(d), `point ${i}`).toBe(true);
      expect(d, `point ${i} margin`).toBeLessThanOrEqual(9 + 1e-9); // hw 10 − 1
    }
    const zero = racingTargetPoints(RECT, 2, new Array(RECT.length).fill(1), new Array(RECT.length).fill(1));
    for (let i = 0; i < zero.length; i++) {
      expect(zero[i][0]).toBeCloseTo(RECT[i][0], 9);
      expect(zero[i][1]).toBeCloseTo(RECT[i][1], 9);
    }
  });

  it('POST4: NeuralDriver constructor rejects a weights length other than N_W', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    expect(() => new NeuralDriver(new Float64Array(N_W - 1), feats)).toThrow(/Invalid neural model/);
    expect(() => new NeuralDriver(new Float64Array(0), feats)).toThrow(/Invalid neural model/);
  });

  it('POST5: parseNeuralModel rejects non-finite weights and non-paddable extremes, accepts a zero-input genome', () => {
    const nan = new Array<number>(N_W).fill(0);
    nan[7] = Number.NaN;
    expect(() => parseNeuralModel({ weights: nan })).toThrow(/Invalid neural model/);
    const inf = new Array<number>(N_W).fill(0);
    inf[N_W - 1] = Number.POSITIVE_INFINITY;
    expect(() => parseNeuralModel({ weights: inf })).toThrow(/Invalid neural model/);
    expect(() => parseNeuralModel({ weights: [] })).toThrow(/Invalid neural model/);
    expect(() => parseNeuralModel({ weights: new Array<number>(626).fill(0) })).toThrow(
      /Invalid neural model/,
    ); // nIn 36 > N_IN
    const zeroIn = parseNeuralModel({ weights: new Array<number>(50).fill(0) });
    expect(zeroIn.length).toBe(N_W);
  });

  it('POST6: fill tolerates more than 64 others within range (buffer cap, no throw)', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    const others = Array.from({ length: 100 }, (_, j) => other(0, -(j + 1)));
    expect(() => feats.fill(out, makeState({ others }))).not.toThrow();
    expect(out[23]).toBeCloseTo(1 / 50, 12);
    expect(out[26]).toBeCloseTo(2 / 50, 12);
    expect(out[29]).toBeCloseTo(3 / 50, 12);
    expect(out[32]).toBeCloseTo(4 / 50, 12);
  });

  it('POST7: neural with a model map missing the race difficulty falls back to classic', async () => {
    const expert = parseNeuralModel(
      JSON.parse(readFileSync(join(ROOT, 'public/ai-models/monza-f4/expert.json'), 'utf8')),
    );
    const config: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 1,
      aiCount: 1,
      difficulty: 'easy',
      seed: 3,
    };
    const classic = await aiFinalPosition(config, 2);
    const fallback = await aiFinalPosition(config, 2, { aiDriver: 'neural', neuralModels: { expert } });
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(fallback[axis] - classic[axis]), axis).toBeLessThanOrEqual(1e-9);
    }
  }, 60_000);

  it('POST8: policy.mts re-exports the shared policy; randomGenome stays deterministic with throttle prior', async () => {
    // @ts-expect-error TS5097: .mts extension imports are allowed at runtime by Vite, not by tsc here
    const policy = await import('../../../scripts/evolve/policy.mts');
    expect(policy.N_W).toBe(N_W);
    expect(typeof policy.forward).toBe('function');
    expect(typeof policy.padGenome).toBe('function');
    const a = policy.randomGenome(policy.mulberry32(42));
    const b = policy.randomGenome(policy.mulberry32(42));
    expect(a.length).toBe(N_W);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[N_W - 1]).toBe(0.8);
    expect(Array.from(a).some((v, i) => i !== N_W - 1 && v !== 0)).toBe(true);
  });

  it('POST9: export picks the fastest expert across line dirs and keeps that line whole set and line field', () => {
    const index = JSON.parse(readFileSync(join(ROOT, 'public/ai-models/index.json'), 'utf8')) as Record<
      string,
      string[]
    >;
    const srcRoot = join(ROOT, 'scripts/evolve/models');
    const dirs = readdirSync(srcRoot).filter((d) => existsSync(join(srcRoot, d, 'index.json')));
    for (const [key, diffs] of Object.entries(index)) {
      const candidates = dirs.filter((d) => d.replace(/-(racing|mintime)$/, '') === key);
      expect(candidates.length, `${key} candidates`).toBeGreaterThan(0);
      const experts = candidates.map((d) => {
        const idx = JSON.parse(readFileSync(join(srcRoot, d, 'index.json'), 'utf8')) as {
          difficulties?: Record<string, string>;
        };
        const file = idx.difficulties?.expert;
        expect(file, `${d} has expert`).toBeTruthy();
        const g = JSON.parse(readFileSync(join(srcRoot, d, file!), 'utf8')) as { bestLap: number };
        return g.bestLap;
      });
      const minBest = Math.min(...experts);
      const winner = candidates[experts.indexOf(minBest)];
      const winIdx = JSON.parse(readFileSync(join(srcRoot, winner, 'index.json'), 'utf8')) as {
        line?: string;
        difficulties?: Record<string, string>;
      };
      const expertOut = JSON.parse(
        readFileSync(join(ROOT, `public/ai-models/${key}/expert.json`), 'utf8'),
      ) as { bestLap: number; line?: string; weights: number[] };
      expect(expertOut.bestLap, `${key} expert bestLap`).toBe(minBest);
      const srcExpert = JSON.parse(
        readFileSync(join(srcRoot, winner, winIdx.difficulties!.expert!), 'utf8'),
      ) as { line?: string };
      expect(expertOut.line ?? 'center', `${key} line`).toBe(srcExpert.line ?? winIdx.line ?? 'center');
      for (const d of diffs) {
        const srcFile = winIdx.difficulties?.[d];
        expect(srcFile, `${winner} has ${d}`).toBeTruthy();
        const src = JSON.parse(readFileSync(join(srcRoot, winner, srcFile!), 'utf8')) as {
          bestLap: number;
          nIn: number;
          gen: number;
          avgLap: number;
        };
        const out = JSON.parse(
          readFileSync(join(ROOT, `public/ai-models/${key}/${d}.json`), 'utf8'),
        ) as typeof src;
        expect(out.bestLap, `${key}/${d} bestLap`).toBe(src.bestLap);
        expect(out.nIn, `${key}/${d} nIn`).toBe(src.nIn);
        expect(out.gen, `${key}/${d} gen`).toBe(src.gen);
        expect(out.avgLap, `${key}/${d} avgLap`).toBe(src.avgLap);
      }
      const wantMt = (expertOut.line ?? 'center') === 'mintime';
      expect(existsSync(join(ROOT, `public/ai-models/${key}/line-mintime.json`)), `${key} mintime file`).toBe(
        wantMt,
      );
    }
  });

  it('POST10: RaceGame neuralLine racing and mintime wire into the neural features (AI diverges from centerline)', async () => {
    const expert = parseNeuralModel(
      JSON.parse(readFileSync(join(ROOT, 'public/ai-models/monza-f4/expert.json'), 'utf8')),
    );
    const config: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 1,
      aiCount: 1,
      difficulty: 'expert',
      seed: 3,
    };
    const base = await aiFinalPosition(config, 10, { aiDriver: 'neural', neuralModels: { expert } });
    const racing = await aiFinalPosition(config, 10, {
      aiDriver: 'neural',
      neuralModels: { expert },
      neuralLine: { kind: 'racing' },
    });
    const track = parseTrackData(
      JSON.parse(readFileSync(join(ROOT, 'public/tracks/monza.json'), 'utf8')),
    ) as TrackDataV2;
    const mintime = await aiFinalPosition(config, 10, {
      aiDriver: 'neural',
      neuralModels: { expert },
      neuralLine: {
        kind: 'mintime',
        pts: track.centerline.map(([x, z]): [number, number] => [x, z]),
        v: new Array(track.centerline.length).fill(20),
      },
    });
    for (const [name, p] of [['racing', racing], ['mintime', mintime]] as const) {
      const d = Math.hypot(p.x - base.x, p.y - base.y, p.z - base.z);
      expect(d, `${name} vs centerline distance`).toBeGreaterThan(0.1);
    }
  }, 120_000);

  it('POST11: traffic sensor projects gaps into the car frame for a rotated car', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    const SQRT1_2 = Math.SQRT1_2;
    // Car faces -X (yaw 90°); other 10 m ahead and 5 m to its left.
    feats.fill(
      out,
      makeState({
        rotation: { x: 0, y: SQRT1_2, z: 0, w: SQRT1_2 },
        others: [other(-10, 5, { x: -4, y: 0, z: 0 })],
      }),
    );
    expect(out[23]).toBeCloseTo(0.2, 12); // 10 m along forward / 50
    expect(out[24]).toBeCloseTo(-0.5, 12); // left 5 m → negative lateral / 10
    expect(out[25]).toBeCloseTo(-4 / 20, 12); // other's body-frame fwd speed +4 → negative cue
  });

  it('POST12: mintimeSpeed longer than the centerline ignores extras; non-number weights throw', () => {
    const mtLong = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12, {
      points: STRAIGHT,
      mintimeSpeed: [...new Array(21).fill(50), 123, 456],
    });
    expect(mtLong.speedAt(20)).toBeCloseTo(48.5, 12);
    const out = new Float64Array(N_IN);
    expect(() => mtLong.fill(out, makeState())).not.toThrow();
    for (let i = 0; i < N_IN; i++) expect(Number.isFinite(out[i]), `slot ${i}`).toBe(true);
    expect(() => parseNeuralModel({ weights: new Array(N_W).fill(true) })).toThrow(
      /Invalid neural model/,
    );
    const holes = new Array<number>(N_W).fill(0);
    holes[3] = undefined as unknown as number;
    expect(() => parseNeuralModel({ weights: holes })).toThrow(/Invalid neural model/);
  });

  it('POST13: fill is periodic in progress.distance with period L (multi-lap wrap)', () => {
    const feats = new NeuralFeatures(RECT, RECT_HW, RECT_HW);
    const outA = new Float64Array(N_IN);
    const outB = new Float64Array(N_IN);
    const L = 600; // RECT perimeter, 10 m per segment
    feats.fill(outA, makeState({ progress: { index: 25, distance: 250, lateral: 1 } }));
    feats.fill(outB, makeState({ progress: { index: 25, distance: 250 + 2 * L, lateral: 1 } }));
    for (let i = 0; i < N_IN; i++) expect(outB[i], `slot ${i}`).toBe(outA[i]);
    expect(outA.some((v, i) => i >= 1 && i <= 9 && v !== 0), 'non-degenerate angles').toBe(true);
  });

  it('POST14: look-ahead and +30 m cues rescan a stale index; at-index cues need the true one', () => {
    const feats = new NeuralFeatures(RECT, RECT_HW, RECT_HW);
    const good = new Float64Array(N_IN);
    const stale = new Float64Array(N_IN);
    // distance 190 m sits on segment 19 just before the corner; index 0 is deliberately wrong.
    feats.fill(good, makeState({ progress: { index: 19, distance: 190, lateral: 0 } }));
    feats.fill(stale, makeState({ progress: { index: 0, distance: 190, lateral: 0 } }));
    for (let i = 0; i < N_IN; i++) {
      if (i === 13 || i === 15 || i === 16 || i === 17) continue; // vProf/halfWidth at p.index by design
      expect(stale[i], `slot ${i}`).toBe(good[i]);
    }
    expect(good[1]).not.toBe(good[3]); // +5 m still straight, +20 m already turning
  });

  it('POST15: decide returns the shared result object that later evaluations mutate', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const w = new Float64Array(N_W);
    w[N_W - 2] = 0.5;
    const driver = new NeuralDriver(w, feats);
    const s = makeState({ forwardSpeed: 20 });
    const d0 = driver.decide(0, s);
    expect(driver.decide(1, s)).toBe(d0);
    expect(driver.decide(3, s)).toBe(d0);
    s.forwardSpeed = 50;
    const d4 = driver.decide(4, s);
    expect(d4).toBe(d0); // held alias, not a copy
    s.forwardSpeed = 0;
    const d5 = driver.decide(5, s);
    expect(d5).toBe(d0);
  });

  it('POST16: parseNeuralModel rejects sub-tail lengths and accepts a 1-input genome', () => {
    for (const bad of [1, 34, 49, 51]) {
      expect(() => parseNeuralModel({ weights: new Array<number>(bad).fill(0) }), `len ${bad}`).toThrow(
        /Invalid neural model/,
      );
    }
    const nIn1 = 66; // nIn 1 layout: 1*16 + 16 + 32 + 2
    const old = new Array<number>(nIn1).fill(0);
    old[0] = 0.25;
    for (let i = 16; i < nIn1; i++) old[i] = i / 100;
    const padded = parseNeuralModel({ weights: old });
    expect(padded.length).toBe(N_W);
    expect(padded[0]).toBe(0.25);
    for (let i = 1; i < 16; i++) expect(padded[i], `row0 slot ${i}`).toBe(0);
    for (let i = 0; i < nIn1 - 16; i++) expect(padded[16 * 35 + i]).toBe(old[16 + i]);
  });

  it('POST17: two drivers sharing one features instance stay independent under interleaving', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const wA = new Float64Array(N_W);
    wA[N_W - 2] = 0.4;
    const wB = new Float64Array(N_W);
    wB[N_W - 2] = -0.4;
    const sA = makeState({ forwardSpeed: 30 });
    const sB = makeState({ forwardSpeed: 15 });
    const alone: Array<Array<{ steer: number; throttle: number; brake: number }>> = [[], []];
    for (const [k, w] of [[0, wA], [1, wB]] as const) {
      const d = new NeuralDriver(w, feats);
      for (const step of [0, 4, 8]) alone[k].push({ ...d.decide(step, k === 0 ? sA : sB) });
    }
    const a = new NeuralDriver(wA, feats);
    const b = new NeuralDriver(wB, feats);
    for (const step of [0, 4, 8]) {
      const da = a.decide(step, sA);
      const db = b.decide(step, sB);
      for (const key of ['steer', 'throttle', 'brake'] as const) {
        expect(da[key], `A step ${step} ${key}`).toBe(alone[0][[0, 4, 8].indexOf(step)][key]);
        expect(db[key], `B step ${step} ${key}`).toBe(alone[1][[0, 4, 8].indexOf(step)][key]);
      }
    }
  });

  it('POST18: zero fuel and negative grip/edge extremes scale linearly into the cues', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    feats.fill(
      out,
      makeState({
        fuelMassKg: 0,
        compoundGrip: -0.4,
        progress: { index: 0, distance: 0, lateral: 15 },
      }),
    );
    expect(out[21]).toBe(0);
    expect(out[22]).toBeCloseTo(-4, 12);
    expect(out[16]).toBeCloseTo(-0.3, 12); // (12 − 15) / 10 past the right edge
    expect(out[17]).toBeCloseTo(2.3, 12); // (8 + 15) / 10
    feats.fill(out, makeState({ progress: { index: 0, distance: 0, lateral: -20 } }));
    expect(out[16]).toBeCloseTo(3.2, 12);
    expect(out[17]).toBeCloseTo(-1.2, 12); // (8 − 20) / 10 past the left edge
  });

  it('POST19: aiDriver neural with neuralModels omitted falls back to classic', async () => {
    const config: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 1,
      aiCount: 1,
      difficulty: 'expert',
      seed: 3,
    };
    const classic = await aiFinalPosition(config, 2);
    const fallback = await aiFinalPosition(config, 2, { aiDriver: 'neural' });
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(fallback[axis] - classic[axis]), axis).toBeLessThanOrEqual(1e-9);
    }
  }, 60_000);
});

async function aiFinalPosition(
  config: RaceConfig,
  seconds: number,
  options?: RaceGameOptions,
): Promise<{ x: number; y: number; z: number }> {
  const track = parseTrackData(
    JSON.parse(readFileSync(join(ROOT, `public/tracks/${config.trackId}.json`), 'utf8')),
  ) as TrackDataV2;
  const spec: CarSpec = parseCarSpec(
    JSON.parse(readFileSync(join(ROOT, `public/cars/${config.carId}.json`), 'utf8')),
  );
  const game = await RaceGame.create(track, spec, config, options);
  const buf = Array.from({ length: game.carCount }, () => createVehicleState(4));
  try {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) game.step(BRAKE);
    game.getStates(buf);
    return { ...buf[1].position };
  } finally {
    game.dispose();
  }
}

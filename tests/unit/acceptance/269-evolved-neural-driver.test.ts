import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { N_IN, N_W, forward, parseNeuralModel } from '../../../src/ai/neuralPolicy';
import type { NeuralCarState, NeuralFeatures } from '../../../src/ai/neuralFeatures';
import { NeuralDriver } from '../../../src/ai/neuralDriver';
import {
  RaceGame,
  type RaceConfig,
  type RaceGameOptions,
} from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { Standing } from '../../../src/race/classification';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };
const RESET_JUMP_M = 2; // a respawn teleports farther than physics can move in one step

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson(`public/tracks/${id}.json`)) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function modelPath(track: string, car: string, difficulty: string): string {
  return `public/ai-models/${track}-${car}/${difficulty}.json`;
}

function loadModelWeights(track: string, car: string, difficulty: string): Float64Array {
  return parseNeuralModel(readJson(modelPath(track, car, difficulty)));
}

function loadModelBestLap(track: string, car: string, difficulty: string): number {
  return (readJson(modelPath(track, car, difficulty)) as { bestLap: number }).bestLap;
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

interface RaceRun {
  standings: readonly Standing[];
  resetsByCar: number[];
  finalPositions: Array<{ x: number; y: number; z: number }>;
  pathM: number[];
}

async function runRace(
  trackId: string,
  config: RaceConfig,
  seconds: number,
  options?: RaceGameOptions,
  untilAiFinished = false,
): Promise<RaceRun> {
  const game = await RaceGame.create(loadTrack(trackId), loadSpec(), config, options);
  const n = game.carCount;
  const buf = Array.from({ length: n }, () => createVehicleState(4));
  const resetsByCar = new Array<number>(n).fill(0);
  const pathM = new Array<number>(n).fill(0);
  const prev = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  let seeded = false;
  try {
    for (let i = 0; i < steps(seconds); i++) {
      game.step(BRAKE);
      game.getStates(buf);
      for (let k = 0; k < n; k++) {
        const p = buf[k].position;
        if (seeded) {
          const d = Math.hypot(p.x - prev[k].x, p.y - prev[k].y, p.z - prev[k].z);
          pathM[k] += d;
          if (d > RESET_JUMP_M) resetsByCar[k]++;
        }
        prev[k] = { x: p.x, y: p.y, z: p.z };
      }
      seeded = true;
      if (untilAiFinished && config.aiCount > 0) {
        const ai = game.standings().find((s) => s.car === 1);
        if (ai?.finished) break;
      }
    }
    return {
      standings: game.standings().map((s) => ({ ...s })),
      resetsByCar,
      finalPositions: buf.slice(1).map((s) => ({ ...s.position })),
      pathM,
    };
  } finally {
    game.dispose();
  }
}

function aiStanding(run: RaceRun, car: number): Standing {
  const row = run.standings.find((s) => s.car === car);
  if (!row) throw new Error(`no standing for car ${car}`);
  return row;
}

describe('269 evolved neural driver acceptance', () => {
  it('AT7: parseNeuralModel accepts 610 weights, pads a 21-input genome, throws on 611', () => {
    const full = new Float64Array(N_W);
    for (let i = 0; i < N_W; i++) full[i] = ((i * 17) % 9 - 4) / 40;
    const parsed = parseNeuralModel({ weights: Array.from(full) });
    expect(parsed).toBeInstanceOf(Float64Array);
    expect(parsed.length).toBe(N_W);
    for (let i = 0; i < N_W; i++) expect(parsed[i]).toBe(full[i]);

    const nInOld = 21;
    const lenOld = nInOld * 16 + 16 + 32 + 2;
    expect(lenOld).toBe(386);
    const old = new Float64Array(lenOld);
    for (let i = 0; i < lenOld; i++) old[i] = ((i * 13) % 7 - 3) / 20;
    const padded = parseNeuralModel({ weights: Array.from(old) });
    expect(padded.length).toBe(N_W);
    for (let h = 0; h < 16; h++) {
      for (let i = 0; i < nInOld; i++) expect(padded[h * N_IN + i]).toBe(old[h * nInOld + i]);
      for (let i = nInOld; i < N_IN; i++) expect(padded[h * N_IN + i]).toBe(0);
    }
    const tailOld = nInOld * 16;
    const tail = N_IN * 16;
    for (let i = 0; i < 16 + 32 + 2; i++) expect(padded[tail + i]).toBe(old[tailOld + i]);

    const x21 = new Float64Array(21);
    for (let i = 0; i < 21; i++) x21[i] = ((i * 13) % 7) / 10;
    const xIn = new Float64Array(N_IN);
    for (let i = 0; i < 21; i++) xIn[i] = x21[i];
    const outOld = new Float64Array(2);
    const outNew = new Float64Array(2);
    forward21(old, x21, outOld);
    forward(padded, xIn, outNew);
    for (let k = 0; k < 2; k++) expect(outNew[k]).toBeCloseTo(outOld[k], 12);

    expect(() => parseNeuralModel({ weights: new Array<number>(611).fill(0) })).toThrow(
      /Invalid neural model/,
    );
  });

  it('AT9: NeuralDriver.decide evaluates features/forward only on steps 0, 4, 8 and holds otherwise', () => {
    const weights = new Float64Array(N_W);
    for (let i = 0; i < N_W; i++) weights[i] = ((i * 17) % 9 - 4) / 40;
    let fills = 0;
    const features = {
      fill(out: Float64Array, s: NeuralCarState): void {
        fills++;
        out.fill(0);
        out[0] = s.forwardSpeed / 60;
      },
    } as unknown as NeuralFeatures;
    const driver = new NeuralDriver(weights, features);
    const s: NeuralCarState = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      forwardSpeed: 0,
      linvel: { x: 0, y: 0, z: 0 },
      angvel: { x: 0, y: 0, z: 0 },
      progress: { index: 0, distance: 0, lateral: 0 },
      fuelMassKg: 0,
      compoundGrip: 0,
      others: [],
    };
    const decisions: Array<{ steer: number; throttle: number; brake: number }> = [];
    const evaluated: number[] = [];
    for (let step = 0; step < 12; step++) {
      s.forwardSpeed = step;
      const before = fills;
      const d = driver.decide(step, s);
      if (fills > before) evaluated.push(step);
      decisions.push(d);
    }
    expect(evaluated).toEqual([0, 4, 8]);
    for (const step of [1, 2, 3, 5, 6, 7, 9, 10, 11]) {
      expect(decisions[step]).toEqual(decisions[Math.floor(step / 4) * 4]);
    }
  });

  it('AT8: export-ai-models output lists every exported model with 610 weights', () => {
    const indexPath = join(ROOT, 'public/ai-models/index.json');
    expect(existsSync(indexPath), 'public/ai-models/index.json must exist').toBe(true);
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, string[]>;
    const srcRoot = join(ROOT, 'scripts/evolve/models');
    const srcDirs = existsSync(srcRoot)
      ? readdirSync(srcRoot).filter((d) => existsSync(join(srcRoot, d, 'index.json')))
      : [];
    for (const dir of srcDirs) {
      const base = dir.replace(/-(racing|mintime)$/, '');
      expect(Object.keys(index), `index lists ${base}`).toContain(base);
    }
    for (const [key, diffs] of Object.entries(index)) {
      expect(diffs.length, `${key} difficulties`).toBeGreaterThan(0);
      for (const d of diffs) {
        const file = join(ROOT, `public/ai-models/${key}/${d}.json`);
        expect(existsSync(file), file).toBe(true);
        const json = JSON.parse(readFileSync(file, 'utf8')) as { weights: number[] };
        expect(json.weights.length, file).toBe(N_W);
      }
    }
  });

  it('AT5: neural AI without a silverstone model falls back to classic and moves > 10 m', async () => {
    const config: RaceConfig = {
      trackId: 'silverstone',
      carId: 'f4',
      laps: 1,
      aiCount: 1,
      difficulty: 'medium',
      seed: 3,
    };
    const neural = await runRace('silverstone', config, 10, { aiDriver: 'neural', neuralModels: {} });
    const classic = await runRace('silverstone', config, 10);
    expect(neural.pathM[0], 'AI path length').toBeGreaterThan(10);
    for (let k = 0; k < classic.finalPositions.length; k++) {
      const a = neural.finalPositions[k];
      const b = classic.finalPositions[k];
      expect(Math.abs(a.x - b.x), `car ${k + 1} x`).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(a.y - b.y), `car ${k + 1} y`).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(a.z - b.z), `car ${k + 1} z`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT6: same neural setup and seed gives identical AI position after 60 s', async () => {
    const expert = loadModelWeights('monza', 'f4', 'expert');
    const config: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 3,
      aiCount: 1,
      difficulty: 'expert',
      seed: 3,
    };
    const options: RaceGameOptions = { aiDriver: 'neural', neuralModels: { expert } };
    const a = await runRace('monza', config, 60, options);
    const b = await runRace('monza', config, 60, options);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(
        Math.abs(a.finalPositions[0][axis] - b.finalPositions[0][axis]),
        axis,
      ).toBeLessThanOrEqual(1e-9);
    }
  }, 600_000);

  it(
    'AT1: neural expert on monza finishes 3 laps, 0 resets, best lap <= 1.08x model bestLap',
    async () => {
      const expert = loadModelWeights('monza', 'f4', 'expert');
      const modelBest = loadModelBestLap('monza', 'f4', 'expert');
      const config: RaceConfig = {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 1,
        difficulty: 'expert',
        seed: 3,
      };
      const run = await runRace(
        'monza',
        config,
        600,
        { aiDriver: 'neural', neuralModels: { expert } },
        true,
      );
      const ai = aiStanding(run, 1);
      expect(ai.finished, 'AI finished 3 laps').toBe(true);
      expect(run.resetsByCar[1], 'AI resets').toBe(0);
      expect(ai.bestLap, 'AI best lap').not.toBeNull();
      expect(ai.bestLap!).toBeLessThanOrEqual(1.08 * modelBest);
    },
    600_000,
  );

  it(
    'AT2: neural expert on spa finishes 2 laps, 0 resets, best lap <= 1.10x model bestLap',
    async (ctx) => {
      if (!existsSync(join(ROOT, modelPath('spa', 'f4', 'expert')))) {
        ctx.skip('public/ai-models/spa-f4/expert.json does not exist');
      }
      const expert = loadModelWeights('spa', 'f4', 'expert');
      const modelBest = loadModelBestLap('spa', 'f4', 'expert');
      const config: RaceConfig = {
        trackId: 'spa',
        carId: 'f4',
        laps: 2,
        aiCount: 1,
        difficulty: 'expert',
        seed: 3,
      };
      const run = await runRace(
        'spa',
        config,
        600,
        { aiDriver: 'neural', neuralModels: { expert } },
        true,
      );
      const ai = aiStanding(run, 1);
      expect(ai.finished, 'AI finished 2 laps').toBe(true);
      expect(run.resetsByCar[1], 'AI resets').toBe(0);
      expect(ai.bestLap, 'AI best lap').not.toBeNull();
      expect(ai.bestLap!).toBeLessThanOrEqual(1.10 * modelBest);
    },
    600_000,
  );

  it(
    'AT3: 7 medium neural AIs each complete >= 1 lap in 300 s with total resets <= 2',
    async () => {
      const medium = loadModelWeights('monza', 'f4', 'medium');
      const config: RaceConfig = {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 7,
        difficulty: 'medium',
        seed: 3,
      };
      const run = await runRace('monza', config, 300, {
        aiDriver: 'neural',
        neuralModels: { medium },
      });
      for (let k = 1; k <= 7; k++) {
        expect(aiStanding(run, k).lap, `AI ${k} laps`).toBeGreaterThanOrEqual(1);
      }
      const total = run.resetsByCar.slice(1).reduce((a, b) => a + b, 0);
      expect(total, 'total AI resets').toBeLessThanOrEqual(2);
    },
    600_000,
  );

  it(
    'AT4: neural expert laps faster than neural easy on monza',
    async () => {
      const expert = loadModelWeights('monza', 'f4', 'expert');
      const easy = loadModelWeights('monza', 'f4', 'easy');
      const base = { trackId: 'monza', carId: 'f4', laps: 2, aiCount: 1, seed: 3 } as const;
      const expertRun = await runRace(
        'monza',
        { ...base, difficulty: 'expert' },
        600,
        { aiDriver: 'neural', neuralModels: { expert } },
        true,
      );
      const easyRun = await runRace(
        'monza',
        { ...base, difficulty: 'easy' },
        600,
        { aiDriver: 'neural', neuralModels: { easy } },
        true,
      );
      const expertBest = aiStanding(expertRun, 1).bestLap;
      const easyBest = aiStanding(easyRun, 1).bestLap;
      expect(expertBest, 'expert best lap').not.toBeNull();
      expect(easyBest, 'easy best lap').not.toBeNull();
      expect(expertBest!).toBeLessThan(easyBest!);
    },
    600_000,
  );
});

// 21-input MLP reference (N_IN = 21 layout before the traffic/fuel inputs existed).
function forward21(w: ArrayLike<number>, x: ArrayLike<number>, out: Float64Array): void {
  const NIN = 21;
  const HID = 16;
  const hid = new Float64Array(HID);
  let o = 0;
  for (let h = 0; h < HID; h++) {
    let sum = 0;
    for (let i = 0; i < NIN; i++) sum += w[o + i] * x[i];
    o += NIN;
    hid[h] = Math.tanh(sum + w[NIN * HID + h]);
  }
  o = NIN * HID + HID;
  for (let k = 0; k < 2; k++) {
    let sum = w[o + HID * 2 + k];
    for (let h = 0; h < HID; h++) sum += w[o + k * HID + h] * hid[h];
    out[k] = Math.tanh(sum);
  }
}

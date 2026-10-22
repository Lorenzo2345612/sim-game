import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { TrackDataV2 } from '../../../src/core/types';
import { N_IN, N_W, forward, padGenome, parseNeuralModel, neuralCarSpec, N_IN_V1, N_W_V1 } from '../../../src/ai/neuralPolicy';
import { NeuralFeatures, racingTargetPoints, type NeuralCarState } from '../../../src/ai/neuralFeatures';
import { RaceGame } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { applySetup, clampSetup, defaultSetup, type Setup } from '../../../src/physics/setup';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt, hasKerb } from '../../../src/track/surfaces';
import { joinGenome, splitGenome, N_SET } from '../../../scripts/evolve/genome.mts';
import { trackLimits } from '../../../scripts/evolve/limits.mts';

const ROOT = join(__dirname, '..', '..', '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(readJson(`public/tracks/${id}.json`)) as TrackDataV2;
}

describe('270 neural driver v2 acceptance', () => {
  it('AT1: racing targets use kerbs on kerb sides and stay inside the usable half width', () => {
    const track = loadTrack('cleveland');
    const cl = track.centerline;
    const n = cl.length;
    const hwL: number[] = [], hwR: number[] = [], kL: boolean[] = [], kR: boolean[] = [];
    for (let i = 0; i < n; i++) {
      hwL.push(halfWidthAt(track, 'left', i));
      hwR.push(halfWidthAt(track, 'right', i));
      kL.push(hasKerb(track, 'left', i));
      kR.push(hasKerb(track, 'right', i));
    }
    const pts = racingTargetPoints(cl, hwL, hwR, kL, kR);
    expect(pts.length).toBe(n);
    let beyondKerb = false;
    for (let i = 0; i < n; i++) {
      const a = cl[(i - 1 + n) % n], b = cl[(i + 1) % n];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
      const lat = (pts[i][0] - cl[i][0]) * (-tz / l) + (pts[i][1] - cl[i][1]) * (tx / l);
      const maxL = hwL[i] + (kL[i] ? KERB_WIDTH - 0.3 : -0.6);
      const maxR = hwR[i] + (kR[i] ? KERB_WIDTH - 0.3 : -0.6);
      expect(lat).toBeGreaterThanOrEqual(-maxL - 1e-9);
      expect(lat).toBeLessThanOrEqual(maxR + 1e-9);
      if ((kR[i] && lat > hwR[i]) || (kL[i] && -lat > hwL[i])) beyondKerb = true;
    }
    expect(beyondKerb).toBe(true);
  });

  it('AT2: features 35..38 encode front/rear tyre temperature, wear and off-track wheels', () => {
    expect(N_IN_V1).toBe(39); // v1 layout; combat inputs follow
    expect(N_W_V1).toBe(674);
    const spec = loadSpec();
    const c = spec.tyres.compounds.medium;
    const centerline: [number, number][] = [];
    for (let i = 0; i < 100; i++) centerline.push([i * 5, 0]);
    const hw = new Array<number>(100).fill(6);
    const features = new NeuralFeatures(centerline, hw, hw);
    const s: NeuralCarState = {
      position: { x: 100, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      forwardSpeed: 20,
      linvel: { x: 0, y: 0, z: -20 },
      angvel: { x: 0, y: 0, z: 0 },
      progress: { index: 20, distance: 100, lateral: 0 },
      fuelMassKg: 10,
      compoundGrip: 0,
      others: [],
      tempFrontC: c.optTempC + c.tempWindowC,
      tempRearC: c.optTempC,
      optTempC: c.optTempC,
      tempWindowC: c.tempWindowC,
      wearMean: 0.5,
      offWheels: 2,
    };
    const out = new Float64Array(N_IN);
    features.fill(out, s);
    const expected = [1, 0, 0.5, 0.5];
    for (let k = 0; k < 4; k++) expect(Math.abs(out[35 + k] - expected[k])).toBeLessThanOrEqual(1e-9);
  });

  it('AT3: parseNeuralModel pads 610, accepts 674 and rejects 675', () => {
    const old = new Array<number>(610);
    for (let i = 0; i < 610; i++) old[i] = ((i * 13) % 7 - 3) / 20;
    const padded = parseNeuralModel({ weights: old });
    expect(padded.length).toBe(N_W);
    const x35 = new Float64Array(N_IN);
    for (let i = 0; i < 35; i++) x35[i] = ((i * 5) % 11) / 10 - 0.5;
    const a = new Float64Array(2);
    const b = new Float64Array(2);
    forward(padded, x35, a);
    const ref = padGenome(old);
    expect(ref).not.toBeNull();
    forward(ref!, x35, b);
    for (let k = 0; k < 2; k++) expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1e-12);
    for (let h = 0; h < 16; h++) {
      for (let i = 0; i < 35; i++) expect(padded[h * N_IN + i]).toBe(old[h * 35 + i]);
      for (let i = 35; i < N_IN; i++) expect(padded[h * N_IN + i]).toBe(0);
    }
    expect(parseNeuralModel({ weights: new Array<number>(674).fill(0.1) }).length).toBe(N_W);
    expect(parseNeuralModel({ weights: new Array<number>(N_W).fill(0.1) }).length).toBe(N_W);
    expect(() => parseNeuralModel({ weights: new Array<number>(675).fill(0) })).toThrow(
      /Invalid neural model/,
    );
  });

  it('AT4: neuralCarSpec applies, clamps and defaults the model setup', () => {
    const f4 = loadSpec();
    const def = defaultSetup(f4);
    const low = neuralCarSpec(f4, { setup: { rearWing: 0 } });
    expect(low.aero.claRear).toBeCloseTo(f4.aero.claRear - 5 * f4.aero.wingStep.claRear, 9);
    const high = neuralCarSpec(f4, { setup: { rearWing: 99 } });
    expect(high).toEqual(applySetup(f4, clampSetup(f4, { ...def, rearWing: 10 })));
    expect(neuralCarSpec(f4, {})).toEqual(applySetup(f4, def));
  });

  it('AT5: RaceGame builds a neural AI car from neuralCarSpec', async () => {
    const f4 = loadSpec();
    const game = await RaceGame.create(
      loadTrack('monza'),
      f4,
      { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 1, difficulty: 'medium', seed: 1 },
      {
        aiDriver: 'neural',
        neuralModels: { medium: new Float64Array(N_W) },
        neuralSetups: { medium: { rearWing: 0 } },
      },
    );
    const internals = game as unknown as { ais: { vehicle: { spec: CarSpec } }[] };
    expect(internals.ais[0].vehicle.spec.aero.claRear).toBeCloseTo(
      f4.aero.claRear - 5 * f4.aero.wingStep.claRear,
      9,
    );
    game.dispose();
  });

  it('AT6: trackLimits invalidates a lap on 4 wheels off and eliminates after 2 s', () => {
    const dt = 1 / 30;
    const a = trackLimits();
    for (let i = 0; i < 300; i++) a.step(3, dt);
    expect(a.lapValid).toBe(true);
    expect(a.eliminated).toBe(false);

    const b = trackLimits();
    for (let i = 0; i < 30; i++) b.step(4, dt);
    for (let i = 0; i < 30; i++) b.step(0, dt);
    expect(b.lapValid).toBe(false);
    expect(b.eliminated).toBe(false);

    const c = trackLimits();
    for (let i = 0; i < 63; i++) c.step(4, dt);
    expect(c.eliminated).toBe(true);
  });

  it('AT7: joinGenome pads old weights and splitGenome maps genes to setup range', () => {
    const f4 = loadSpec();
    const old = new Float64Array(610);
    for (let i = 0; i < 610; i++) old[i] = ((i * 17) % 9 - 4) / 40;
    const padded = padGenome(old)!;
    const zero = joinGenome(old);
    expect(zero.length).toBe(N_W + 8);
    expect(N_SET).toBe(8);
    for (let i = 0; i < N_W; i++) expect(zero[i]).toBe(padded[i]);
    const keys = Object.keys(defaultSetup(f4)) as (keyof Setup)[];
    const def = defaultSetup(f4);
    const z = splitGenome(zero, f4);
    expect(z.weights.length).toBe(N_W);
    for (const k of keys) expect(z.setup[k]).toBeCloseTo(def[k], 9);
    const up = splitGenome(joinGenome(old, new Array<number>(8).fill(1)), f4);
    const down = splitGenome(joinGenome(old, new Array<number>(8).fill(-1)), f4);
    for (const k of keys) {
      expect(up.setup[k]).toBeCloseTo(f4.setup[k].max, 9);
      expect(down.setup[k]).toBeCloseTo(f4.setup[k].min, 9);
    }
  });
});

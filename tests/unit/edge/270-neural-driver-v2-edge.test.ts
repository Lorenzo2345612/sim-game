import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { N_IN, N_W, parseNeuralModel, neuralCarSpec } from '../../../src/ai/neuralPolicy';
import { NeuralFeatures, racingTargetPoints, type NeuralCarState } from '../../../src/ai/neuralFeatures';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { clampSetup, defaultSetup, type Setup } from '../../../src/physics/setup';
import { joinGenome, splitGenome } from '../../../scripts/evolve/genome.mts';
import { trackLimits } from '../../../scripts/evolve/limits.mts';

const ROOT = join(__dirname, '..', '..', '..');
const loadSpec = (): CarSpec =>
  parseCarSpec(JSON.parse(readFileSync(join(ROOT, 'public/cars/f4.json'), 'utf8')));

function feat(over: Partial<NeuralCarState>): Float64Array {
  const spec = loadSpec();
  const c = spec.tyres.compounds.medium;
  const cl: [number, number][] = [];
  for (let i = 0; i < 100; i++) cl.push([i * 5, 0]);
  const hw = new Array<number>(100).fill(6);
  const f = new NeuralFeatures(cl, hw, hw);
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
    tempFrontC: c.optTempC,
    tempRearC: c.optTempC,
    optTempC: c.optTempC,
    tempWindowC: c.tempWindowC,
    wearMean: 0,
    offWheels: 0,
    ...over,
  };
  const out = new Float64Array(N_IN);
  f.fill(out, s);
  return out;
}

describe('270 neural driver v2 edge', () => {
  it('EDGE1: exactly 2.0 s with 4 wheels off is not eliminated, beyond 2.0 s is', () => {
    const a = trackLimits();
    for (let i = 0; i < 4; i++) a.step(4, 0.5);
    expect(a.eliminated).toBe(false);
    a.step(4, 0.5);
    expect(a.eliminated).toBe(true);
  });

  it('EDGE2: a sample with fewer than 4 wheels off resets the continuous elimination timer', () => {
    const t = trackLimits();
    for (let i = 0; i < 3; i++) t.step(4, 0.5);
    t.step(3, 0.5);
    for (let i = 0; i < 3; i++) t.step(4, 0.5);
    expect(t.eliminated).toBe(false);
    expect(t.lapValid).toBe(false);
  });

  it('EDGE3: newLap restores lap validity and a later 4-off sample invalidates again', () => {
    const t = trackLimits();
    expect(t.lapValid).toBe(true);
    t.step(4, 1 / 30);
    expect(t.lapValid).toBe(false);
    t.newLap();
    expect(t.lapValid).toBe(true);
    t.step(2, 1 / 30);
    expect(t.lapValid).toBe(true);
    t.step(4, 1 / 30);
    expect(t.lapValid).toBe(false);
  });

  it('EDGE4: features 35..38 are negative below optimum and offWheels 4 gives 1', () => {
    const spec = loadSpec();
    const c = spec.tyres.compounds.medium;
    const out = feat({
      tempFrontC: c.optTempC - c.tempWindowC,
      tempRearC: c.optTempC + 2 * c.tempWindowC,
      wearMean: 1,
      offWheels: 4,
    });
    const exp = [-1, 2, 1, 1];
    for (let k = 0; k < 4; k++) expect(out[35 + k]).toBeCloseTo(exp[k], 9);
  });

  it('EDGE5: without kerb flags targets stay within hw - 0.6 on both sides', () => {
    const n = 200, r = 60, hwv = 6;
    const cl: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      cl.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    const hw = new Array<number>(n).fill(hwv);
    const kf = new Array<boolean>(n).fill(false);
    const pts = racingTargetPoints(cl, hw, hw, kf, kf);
    expect(pts.length).toBe(n);
    for (let i = 0; i < n; i++) {
      const a = cl[(i - 1 + n) % n], b = cl[(i + 1) % n];
      const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
      const lat = (pts[i][0] - cl[i][0]) * (-tz / l) + (pts[i][1] - cl[i][1]) * (tx / l);
      expect(Math.abs(lat)).toBeLessThanOrEqual(hwv - 0.6 + 1e-9);
    }
  });

  it('EDGE6: parseNeuralModel throws on incompatible lengths', () => {
    expect(() => parseNeuralModel({ weights: new Array<number>(100).fill(0) })).toThrow(/Invalid neural model/);
    expect(() => parseNeuralModel({ weights: [] })).toThrow(/Invalid neural model/);
  });

  it('EDGE7: neuralCarSpec does not mutate its inputs and partial setup keeps other defaults', () => {
    const f4 = loadSpec();
    const before = JSON.stringify(f4);
    const model = { setup: { rearWing: 0 } as Partial<Setup> };
    const out = neuralCarSpec(f4, model);
    expect(JSON.stringify(f4)).toBe(before);
    expect(model).toEqual({ setup: { rearWing: 0 } });
    expect(out.aero.claFront).toBeCloseTo(f4.aero.claFront, 9);
  });

  it('EDGE8: splitGenome interpolates linearly between default and max/min', () => {
    const f4 = loadSpec();
    const def = defaultSetup(f4);
    const keys = Object.keys(def) as (keyof Setup)[];
    for (const [g, bound] of [[0.5, 'max'], [-0.5, 'min']] as const) {
      const r = splitGenome(joinGenome(new Float64Array(N_W), new Array<number>(8).fill(g)), f4);
      const raw = { ...def };
      for (const k of keys) raw[k] = def[k] + 0.5 * (f4.setup[k][bound] - def[k]);
      const exp = clampSetup(f4, raw);
      for (const k of keys) expect(r.setup[k]).toBeCloseTo(exp[k], 9);
    }
  });

  it('EDGE9: joinGenome keeps a full-length weight vector and the given genes', () => {
    const w = new Float64Array(N_W);
    for (let i = 0; i < N_W; i++) w[i] = (i % 5) / 10 - 0.2;
    const genes = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8];
    const g = joinGenome(w, genes);
    expect(g.length).toBe(N_W + 8);
    for (let i = 0; i < N_W; i++) expect(g[i]).toBe(w[i]);
    for (let k = 0; k < 8; k++) expect(g[N_W + k]).toBe(genes[k]);
    expect(splitGenome(g, loadSpec()).weights).toEqual(w);
  });

  it('EDGE10: features 35..38 are zero at optimum temperature, no wear, all wheels on track', () => {
    const out = feat({});
    for (let k = 35; k < 39; k++) expect(out[k]).toBeCloseTo(0, 9);
  });
});

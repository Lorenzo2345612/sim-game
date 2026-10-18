// Evolution genome = network weights followed by N_SET setup genes in [-1, 1] (0 = default, ±1 = range ends).
import { N_W, padGenome } from '../../src/ai/neuralPolicy';
import type { CarSpec } from '../../src/physics/carSpec';
import { clampSetup, defaultSetup, type Setup } from '../../src/physics/setup';

export const N_SET = 8;

const KEYS: readonly (keyof Setup)[] = ['frontWing', 'rearWing', 'brakeBias', 'finalDrive', 'arbFront', 'arbRear', 'rideHeight', 'tyrePressureKpa'];

export function joinGenome(weights: ArrayLike<number>, setupGenes?: ArrayLike<number>): Float64Array {
  const w = padGenome(weights);
  if (!w) throw new Error(`Invalid genome: weights length ${weights.length}`);
  const g = new Float64Array(N_W + N_SET);
  g.set(w);
  if (setupGenes) for (let k = 0; k < N_SET; k++) g[N_W + k] = setupGenes[k] ?? 0;
  return g;
}

export function splitGenome(g: ArrayLike<number>, spec: CarSpec): { weights: Float64Array; setup: Setup } {
  const weights = new Float64Array(N_W);
  for (let i = 0; i < N_W; i++) weights[i] = g[i];
  const def = defaultSetup(spec), raw = { ...def };
  KEYS.forEach((k, j) => {
    const v = Math.max(-1, Math.min(1, g[N_W + j] ?? 0));
    const r = spec.setup[k];
    raw[k] = v >= 0 ? def[k] + v * (r.max - def[k]) : def[k] + -v * (r.min - def[k]);
  });
  return { weights, setup: clampSetup(spec, raw) };
}

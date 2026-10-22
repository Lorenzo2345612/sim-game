// Evolution genome = network weights followed by N_SET setup genes in [-1, 1] (0 = default, ±1 = range ends).
import { N_W, N_W_V1, N_HID_V1, padGenome } from '../../src/ai/neuralPolicy';
import type { CarSpec } from '../../src/physics/carSpec';
import { clampSetup, defaultSetup, type Setup } from '../../src/physics/setup';

export const N_SET = 8;
// Trainer-only extra inputs (residual mode): edge room at +30/60/100 m (right, left) and the previous offset/pace command.
export { X_LOOK, N_X, N_XW } from '../../src/ai/residualPolicy';
import { N_XW, N_X } from '../../src/ai/residualPolicy';
export const N_G = N_W + N_SET + N_XW; // extra-input weights appended after the setup genes (zero = no effect)

const KEYS: readonly (keyof Setup)[] = ['frontWing', 'rearWing', 'brakeBias', 'finalDrive', 'arbFront', 'arbRear', 'rideHeight', 'tyrePressureKpa'];

export function joinGenome(weights: ArrayLike<number>, setupGenes?: ArrayLike<number>, initNew?: () => number): Float64Array {
  const w = padGenome(weights, initNew);
  if (!w) throw new Error(`Invalid genome: weights length ${weights.length}`);
  const g = new Float64Array(N_W + N_SET);
  g.set(w);
  if (setupGenes) for (let k = 0; k < N_SET; k++) g[N_W + k] = setupGenes[k] ?? 0;
  return g;
}

// Trainer genome with the residual extra-input genes: accepts N_G, N_W + N_SET, v1 genomes (674 + 8 [+ 8 * 16 extra])
// or model weights (+ extra). `initNew` seeds the new hidden units' input weights (training expansion only).
export function fullGenome(weights: ArrayLike<number>, extra?: ArrayLike<number>, initNew?: () => number): Float64Array {
  const g = new Float64Array(N_G);
  if (weights.length === N_G || weights.length === N_W + N_SET) { g.set(weights); return g; }
  const V1_XW = N_X * N_HID_V1;
  if (weights.length === N_W_V1 + N_SET + V1_XW || weights.length === N_W_V1 + N_SET) { // v1 trainer genome
    g.set(joinGenome(Array.from(weights).slice(0, N_W_V1), Array.from(weights).slice(N_W_V1, N_W_V1 + N_SET), initNew));
    for (let k = 0; k < V1_XW; k++) g[N_W + N_SET + k] = weights[N_W_V1 + N_SET + k] ?? 0;
    return g;
  }
  g.set(joinGenome(weights, undefined, initNew));
  if (extra) for (let k = 0; k < Math.min(N_XW, extra.length); k++) g[N_W + N_SET + k] = extra[k];
  return g;
}

export function extraOf(g: ArrayLike<number>): Float64Array {
  const e = new Float64Array(N_XW);
  for (let k = 0; k < N_XW; k++) e[k] = g[N_W + N_SET + k] ?? 0;
  return e;
}

export function splitGenome(g: ArrayLike<number>, spec: CarSpec): { weights: Float64Array; setup: Setup; extra: Float64Array } {
  const weights = new Float64Array(N_W);
  for (let i = 0; i < N_W; i++) weights[i] = g[i];
  const def = defaultSetup(spec), raw = { ...def };
  KEYS.forEach((k, j) => {
    const v = Math.max(-1, Math.min(1, g[N_W + j] ?? 0));
    const r = spec.setup[k];
    raw[k] = v >= 0 ? def[k] + v * (r.max - def[k]) : def[k] + -v * (r.min - def[k]);
  });
  return { weights, setup: clampSetup(spec, raw), extra: extraOf(g) };
}

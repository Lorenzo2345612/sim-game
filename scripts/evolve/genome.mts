// Evolution genome = network weights followed by N_SET setup genes in [-1, 1] (0 = default, ±1 = range ends).
import { N_HID, N_W, padGenome } from '../../src/ai/neuralPolicy';
import type { CarSpec } from '../../src/physics/carSpec';
import { clampSetup, defaultSetup, type Setup } from '../../src/physics/setup';

export const N_SET = 8;
// Trainer-only extra inputs (residual mode): edge room at +30/60/100 m (right, left) and the previous offset/pace command.
export const X_LOOK = [30, 60, 100];
export const N_X = 2 * X_LOOK.length + 2;
export const N_XW = N_X * N_HID; // input -> hidden weights, appended after the setup genes (zero = no effect)
export const N_G = N_W + N_SET + N_XW;

const KEYS: readonly (keyof Setup)[] = ['frontWing', 'rearWing', 'brakeBias', 'finalDrive', 'arbFront', 'arbRear', 'rideHeight', 'tyrePressureKpa'];

export function joinGenome(weights: ArrayLike<number>, setupGenes?: ArrayLike<number>, extra?: ArrayLike<number>): Float64Array {
  const g = new Float64Array(N_G);
  if (weights.length === N_W + N_SET || weights.length === N_G) { g.set(weights); return g; }
  const w = padGenome(weights);
  if (!w) throw new Error(`Invalid genome: weights length ${weights.length}`);
  g.set(w);
  if (setupGenes) for (let k = 0; k < N_SET; k++) g[N_W + k] = setupGenes[k] ?? 0;
  if (extra) for (let k = 0; k < N_XW; k++) g[N_W + N_SET + k] = extra[k] ?? 0;
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

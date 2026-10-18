import type { CarSpec } from '../physics/carSpec';
import { applySetup, clampSetup, defaultSetup, type Setup } from '../physics/setup';

// Tiny MLP policy shared by the evolution trainer, its workers and the in-game neural AI (task 269).
export const LOOK = [5, 10, 20, 35, 55, 80, 110, 150, 200]; // m ahead on the centerline
export const PROD = [4, 6, 8]; // LOOK indices also fed as speed × |angle| (brake cue)
export const N_BASE = 1 + LOOK.length + PROD.length + 3 + 5; // speed, look angles, products, speed-profile cues, edges, yaw rate, slip, bias
export const N_NEAR = 4; // nearest cars sensed: forward gap, lateral gap, closing speed each
export const N_IN = N_BASE + 2 + 3 * N_NEAR + 4; // + fuel mass, compound grip, traffic, tyre temps front/rear, wear, off-track wheels (appended so older genomes pad with zeros)
export const N_HID = 16;
export const N_OUT = 2; // steer, throttle(+)/brake(-)
export const N_W = N_IN * N_HID + N_HID + N_HID * N_OUT + N_OUT;

const hid = new Float64Array(N_HID);

export function forward(w: Float64Array, x: Float64Array, out: Float64Array): void {
  let o = 0;
  for (let h = 0; h < N_HID; h++) {
    let s = 0;
    for (let i = 0; i < N_IN; i++) s += w[o + i] * x[i];
    o += N_IN;
    hid[h] = Math.tanh(s + w[N_IN * N_HID + h]);
  }
  o = N_IN * N_HID + N_HID;
  for (let k = 0; k < N_OUT; k++) {
    let s = w[o + N_HID * N_OUT + k];
    for (let h = 0; h < N_HID; h++) s += w[o + k * N_HID + h] * hid[h];
    out[k] = Math.tanh(s);
  }
}

// Pads a genome trained with fewer inputs (new inputs get zero weights: same behaviour at first).
export function padGenome(old: ArrayLike<number>): Float64Array | null {
  const nInOld = (old.length - N_HID - N_HID * N_OUT - N_OUT) / N_HID;
  if (!Number.isInteger(nInOld) || nInOld > N_IN) return null;
  const w = new Float64Array(N_W);
  for (let h = 0; h < N_HID; h++) for (let i = 0; i < nInOld; i++) w[h * N_IN + i] = old[h * nInOld + i];
  const tailOld = nInOld * N_HID, tail = N_IN * N_HID;
  for (let i = 0; i < N_HID + N_HID * N_OUT + N_OUT; i++) w[tail + i] = old[tailOld + i];
  return w;
}

export function neuralCarSpec(spec: CarSpec, model: { setup?: Partial<Setup> }): CarSpec {
  return applySetup(spec, clampSetup(spec, { ...defaultSetup(spec), ...model.setup }));
}

// Accepts a full genome or a shorter paddable one; anything else throws.
export function parseNeuralModel(json: unknown): Float64Array {
  const raw = (json as { weights?: unknown } | null)?.weights;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))
  ) {
    throw new Error('Invalid neural model: weights missing or not finite numbers');
  }
  if (raw.length === N_W) return Float64Array.from(raw);
  const padded = padGenome(raw);
  if (!padded || padded.some((v) => !Number.isFinite(v))) {
    throw new Error(`Invalid neural model: length ${raw.length}`);
  }
  return padded;
}

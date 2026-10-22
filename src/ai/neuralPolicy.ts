import type { CarSpec } from '../physics/carSpec';
import { applySetup, clampSetup, defaultSetup, type Setup } from '../physics/setup';

// Tiny MLP policy shared by the evolution trainer, its workers and the in-game neural AI (task 269).
export const LOOK = [5, 10, 20, 35, 55, 80, 110, 150, 200]; // m ahead on the centerline
export const PROD = [4, 6, 8]; // LOOK indices also fed as speed × |angle| (brake cue)
export const N_BASE = 1 + LOOK.length + PROD.length + 3 + 5; // speed, look angles, products, speed-profile cues, edges, yaw rate, slip, bias
export const N_NEAR = 4; // nearest cars sensed: forward gap, lateral gap, closing speed each
export const N_IN_V1 = N_BASE + 2 + 3 * N_NEAR + 4; // + fuel mass, compound grip, traffic, tyre temps front/rear, wear, off-track wheels (appended so older genomes pad with zeros)
export const N_COMBAT = 8; // v2 combat inputs: overlap L/R, car behind (closeness, closing), next corner, braking distance, attacker-inside, target-inside
export const N_IN = N_IN_V1 + N_COMBAT;
export const N_HID_V1 = 16;
export const N_HID = 32; // v2 net: 32 hidden units
export const N_OUT = 2; // steer, throttle(+)/brake(-)
export const N_W = N_IN * N_HID + N_HID + N_HID * N_OUT + N_OUT;
export const N_W_V1 = N_IN_V1 * N_HID_V1 + N_HID_V1 + N_HID_V1 * N_OUT + N_OUT; // 674

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

// Pads a v1 genome (16 hidden, fewer inputs) to v2: new input weights 0, new hidden units get output weights 0, so the
// function is unchanged. `initNew` (trainer only) gives the new hidden units random input weights; outputs stay 0.
export function padGenome(old: ArrayLike<number>, initNew?: () => number): Float64Array | null {
  if (old.length === N_W) return Float64Array.from(old);
  const H0 = N_HID_V1;
  const nInOld = (old.length - H0 - H0 * N_OUT - N_OUT) / H0;
  if (!Number.isInteger(nInOld) || nInOld < 0 || nInOld > N_IN) return null;
  const w = new Float64Array(N_W);
  for (let h = 0; h < H0; h++) for (let i = 0; i < nInOld; i++) w[h * N_IN + i] = old[h * nInOld + i];
  if (initNew) for (let h = H0; h < N_HID; h++) for (let i = 0; i < N_IN; i++) w[h * N_IN + i] = initNew();
  const tailOld = nInOld * H0, tail = N_IN * N_HID;
  for (let h = 0; h < H0; h++) w[tail + h] = old[tailOld + h];
  for (let k = 0; k < N_OUT; k++) {
    for (let h = 0; h < H0; h++) w[tail + N_HID + k * N_HID + h] = old[tailOld + H0 + k * H0 + h];
    w[tail + N_HID + N_HID * N_OUT + k] = old[tailOld + H0 + H0 * N_OUT + k];
  }
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

// Re-export of the shared policy (moved to src/ai/neuralPolicy.ts, task 269); training unchanged.
import { N_IN, N_HID, N_W } from '../../src/ai/neuralPolicy';
export { LOOK, PROD, N_BASE, N_NEAR, N_IN, N_HID, N_OUT, N_W, forward, padGenome, parseNeuralModel } from '../../src/ai/neuralPolicy';

export function randomGenome(rand: () => number): Float64Array {
  const w = new Float64Array(N_W);
  for (let i = 0; i < N_W; i++) {
    const fanIn = i < N_IN * N_HID + N_HID ? N_IN : N_HID;
    w[i] = gauss(rand) / Math.sqrt(fanIn);
  }
  w[N_W - 1] = 0.8; // throttle prior so early cars move and steering can be selected
  return w;
}

export function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

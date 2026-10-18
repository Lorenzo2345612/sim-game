// Tiny MLP policy shared by the evolution workers and the trainer.
export const LOOK = [5, 10, 20, 35, 55, 80, 110, 150, 200]; // m ahead on the centerline
export const PROD = [4, 6, 8]; // LOOK indices also fed as speed × |angle| (brake cue)
export const N_IN = 1 + LOOK.length + PROD.length + 5; // speed, look angles, products, edges, yaw rate, slip, bias
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

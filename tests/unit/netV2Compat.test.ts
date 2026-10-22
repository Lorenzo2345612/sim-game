import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { N_IN, N_IN_V1, N_HID, N_HID_V1, N_OUT, N_W, N_W_V1, forward, padGenome, parseNeuralModel } from '../../src/ai/neuralPolicy';
import { N_X, parseResidualModel } from '../../src/ai/residualPolicy';

const root = join(__dirname, '../..');

// Frozen v1 reference: 16 hidden units, nIn inputs, tanh MLP.
function forwardV1(w: ArrayLike<number>, x: ArrayLike<number>, nIn: number): [number, number] {
  const hid = new Float64Array(N_HID_V1);
  let o = 0;
  for (let h = 0; h < N_HID_V1; h++) {
    let s = 0;
    for (let i = 0; i < nIn; i++) s += w[o + i] * x[i];
    o += nIn;
    hid[h] = Math.tanh(s + w[nIn * N_HID_V1 + h]);
  }
  o = nIn * N_HID_V1 + N_HID_V1;
  const out: number[] = [];
  for (let k = 0; k < N_OUT; k++) {
    let s = w[o + N_HID_V1 * N_OUT + k];
    for (let h = 0; h < N_HID_V1; h++) s += w[o + k * N_HID_V1 + h] * hid[h];
    out.push(Math.tanh(s));
  }
  return [out[0], out[1]];
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkIdentity(raw: number[], seed: number, label: string, initNew?: () => number): void {
  const nInOld = (raw.length - N_HID_V1 - N_HID_V1 * N_OUT - N_OUT) / N_HID_V1;
  const w = padGenome(raw, initNew)!;
  expect(w.length, label).toBe(N_W);
  const r = rng(seed);
  const x = new Float64Array(N_IN), out = new Float64Array(N_OUT);
  for (let t = 0; t < 300; t++) {
    for (let i = 0; i < N_IN; i++) x[i] = (r() * 2 - 1) * (t % 3 === 0 ? 5 : 1.5);
    forward(w, x, out);
    const [s, th] = forwardV1(raw, x, nInOld);
    expect(out[0] === s, `${label} steer`).toBe(true);
    expect(out[1] === th, `${label} throttle`).toBe(true);
  }
}

const files: [string, string][] = [];
const pub = join(root, 'public/ai-models');
for (const d of readdirSync(pub)) {
  const f = join(pub, d, 'expert.json');
  if (existsSync(f)) files.push([`${d}/expert`, f]);
}
for (const p of [join(root, 'scripts/evolve/models/scratch/aggr4/race-91s-gen551.json'), '/home/blort/dev/sim-game/scripts/evolve/models/scratch/aggr4/race-91s-gen551.json']) {
  if (existsSync(p)) { files.push(['gen551', p]); break; }
}

describe('racecraft net v2 is function-preserving for v1 models', () => {
  it('layout constants', () => {
    expect(N_IN).toBe(N_IN_V1 + 8);
    expect(N_HID).toBe(32);
    expect(N_W_V1).toBe(674);
  });
  it('covers the public models', () => expect(files.length).toBeGreaterThanOrEqual(6));
  for (const [label, f] of files) {
    it(`bit-identical outputs: ${label}`, () => {
      const raw = JSON.parse(readFileSync(f, 'utf8')).weights as number[];
      checkIdentity(raw, 7, label);
      expect(parseNeuralModel({ weights: raw }).length).toBe(N_W);
    });
    it(`bit-identical with random new hidden inputs (training expansion): ${label}`, () => {
      const raw = JSON.parse(readFileSync(f, 'utf8')).weights as number[];
      const g = rng(99);
      checkIdentity(raw, 8, label, () => (g() - 0.5) * 0.6);
    });
  }
  it('residual extra weights keep the output (hidden-bias folding)', () => {
    const f = files.find(([l]) => l === 'gen551');
    if (!f) return;
    const model = JSON.parse(readFileSync(f[1], 'utf8'));
    const res = parseResidualModel(model)!;
    const raw = model.weights as number[];
    const w2 = padGenome(raw)!;
    const r = rng(3);
    const xe = new Float64Array(N_X), x = new Float64Array(N_IN), out = new Float64Array(N_OUT);
    for (let t = 0; t < 100; t++) {
      for (let m = 0; m < N_X; m++) xe[m] = r() * 2 - 1;
      for (let i = 0; i < N_IN; i++) x[i] = r() * 2 - 1;
      const w1 = Float64Array.from(raw);
      const wk = Float64Array.from(w2);
      for (let h = 0; h < N_HID_V1; h++) {
        let s = raw[N_IN_V1 * N_HID_V1 + h];
        for (let m = 0; m < N_X; m++) s += res.extra[h * N_X + m] * xe[m];
        w1[N_IN_V1 * N_HID_V1 + h] = s;
      }
      for (let h = 0; h < N_HID; h++) {
        let s = w2[N_IN * N_HID + h];
        for (let m = 0; m < N_X; m++) s += res.extra[h * N_X + m] * xe[m];
        wk[N_IN * N_HID + h] = s;
      }
      forward(wk, x, out);
      const [a, b] = forwardV1(w1, x, N_IN_V1);
      expect(out[0] === a && out[1] === b).toBe(true);
    }
  });
  it('rejects non-paddable lengths', () => {
    expect(() => parseNeuralModel({ weights: new Array(675).fill(0.1) })).toThrow();
  });
});

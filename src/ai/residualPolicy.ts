import type { NeuralCarState, NeuralFeatures } from './neuralFeatures';
import { N_HID, N_IN, N_OUT, N_W, forward } from './neuralPolicy';

// Residual neural AI: the classic AiDriver drives; the shared MLP only sets its lateral offset
// and pace. Same inputs and cadence as the trainer (scripts/evolve/worker.mts, --residual).
export const X_LOOK = [30, 60, 100]; // m ahead: edge room right/left at each
export const N_X = 2 * X_LOOK.length + 2; // + previous offset and pace outputs
export const N_XW = N_X * N_HID; // extra input -> hidden weights
export const RESIDUAL_EVERY = 4; // steps between decisions

export interface ResidualParams {
  /** m of lateral offset at output ±1. */
  offset: number;
  /** speed-scale gain for output > 0 / < 0. */
  up: number;
  down: number;
}

export interface ResidualModel {
  res: ResidualParams;
  extra: Float64Array;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// null when the model JSON is not residual; throws when it claims to be but is malformed.
export function parseResidualModel(json: unknown): ResidualModel | null {
  const j = json as { residual?: unknown; res?: Partial<ResidualParams>; extra?: unknown } | null;
  if (!j || j.residual !== true) return null;
  const r = j.res;
  if (!r || !finite(r.offset) || !finite(r.up) || !finite(r.down)) {
    throw new Error('Invalid residual model: res.offset/up/down missing or invalid');
  }
  const extra = new Float64Array(N_XW);
  if (j.extra !== undefined) {
    if (!Array.isArray(j.extra) || j.extra.length > N_XW || !j.extra.every(finite)) {
      throw new Error('Invalid residual model: extra');
    }
    extra.set(j.extra as number[]);
  }
  return { res: { offset: r.offset, up: r.up, down: r.down }, extra };
}

// Centerline index `d` metres ahead of each index (cum: closed cumulative lengths, n + 1 entries).
export function aheadIndices(cum: ArrayLike<number>, n: number, d: number): Int32Array {
  const a = new Int32Array(n);
  for (let i = 0, k = 0; i < n; i++) {
    if (k < i) k = i;
    while (k < i + n && cum[k % n] + (k >= n ? cum[n] : 0) - cum[i] < d) k++;
    a[i] = k % n;
  }
  return a;
}

export class ResidualNet {
  private readonly x = new Float64Array(N_IN);
  private readonly xe = new Float64Array(N_X);
  private readonly out = new Float64Array(N_OUT);
  private readonly wk: Float64Array;
  private readonly ahead: Int32Array[];
  private calls = 0;
  private last0 = 0;
  private last1 = 0;
  readonly result = { offset: 0, scale: 1 };

  constructor(
    private readonly weights: Float64Array,
    private readonly model: ResidualModel,
    private readonly features: NeuralFeatures,
    cum: ArrayLike<number>,
    private readonly halfLeft: ArrayLike<number>,
    private readonly halfRight: ArrayLike<number>,
    phase = 0,
  ) {
    this.calls = ((phase % RESIDUAL_EVERY) + RESIDUAL_EVERY) % RESIDUAL_EVERY;
    if (weights.length !== N_W) throw new Error(`ResidualNet: weights length ${weights.length}`);
    this.wk = Float64Array.from(weights);
    this.ahead = X_LOOK.map((d) => aheadIndices(cum, halfLeft.length, d));
  }

  /** True when the next `decide` recomputes (the caller fills the state only then). */
  due(): boolean {
    return this.calls % RESIDUAL_EVERY === 0;
  }

  /** Call once per step; recomputes every RESIDUAL_EVERY calls (first call included). */
  decide(state: NeuralCarState): { offset: number; scale: number } {
    if (this.calls++ % RESIDUAL_EVERY !== 0) return this.result;
    this.features.fill(this.x, state);
    const p = state.progress;
    const xe = this.xe;
    for (let a = 0; a < X_LOOK.length; a++) {
      const q = this.ahead[a][p.index];
      xe[2 * a] = (this.halfRight[q] - p.lateral) / 10;
      xe[2 * a + 1] = (this.halfLeft[q] + p.lateral) / 10;
    }
    xe[N_X - 2] = this.last0;
    xe[N_X - 1] = this.last1;
    // Extra inputs fold into the hidden biases, so the shared forward() is reused unchanged.
    const bias = N_IN * N_HID;
    const ex = this.model.extra;
    for (let h = 0; h < N_HID; h++) {
      let s = this.weights[bias + h];
      for (let m = 0; m < N_X; m++) s += ex[h * N_X + m] * xe[m];
      this.wk[bias + h] = s;
    }
    forward(this.wk, this.x, this.out);
    const r = this.model.res;
    this.last0 = this.out[0];
    this.last1 = this.out[1];
    this.result.offset = this.last0 * r.offset;
    this.result.scale = 1 + (this.last1 > 0 ? r.up : r.down) * this.last1;
    return this.result;
  }
}

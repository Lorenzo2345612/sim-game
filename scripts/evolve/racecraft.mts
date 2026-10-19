// Racecraft scoring for the trainer (task 271): committed position changes, at-fault contacts, crash faults.
export const POS_W = 60, PASS_W = 40, CONTACT_W = 80, CRASH_W = 200;
const PASS_GAP = 20, PASS_MIN_V = 2, PASS_HOLD = 1.0, PASS_REL_V = 0.8, PASS_CLEAN_S = 3.0; // no credit for passing a slow, crashed or just-hit car
const FAULT_CLOSING = 3.0, EPISODE_GAP = 0.5, CRASH_WINDOW = 3.0;

export interface ContactInfo { fwdGap: number; latGap: number; closing: number }
export interface RaceCar { dist: number; speed: number; running: boolean }

export class RacecraftTracker {
  readonly passes: Int32Array;
  readonly lost: Int32Array;
  readonly faults: Int32Array;
  readonly crashFaults: Int32Array;
  private t = 0;
  private readonly n: number;
  // per ordered pair (k*n+j): k ahead of j in the committed order, pending flip start time (-1 none)
  private readonly ahead: Int8Array;
  private readonly flipT: Float64Array;
  private readonly lastTouch: Float64Array; // last time the pair touched (unordered, k<j index)
  private readonly faultedEp: Uint8Array; // pair episode already gave a fault to k (ordered)
  private readonly lastFaultBy: Int32Array; // per victim: car at fault in its latest episode
  private readonly lastFaultT: Float64Array;
  private readonly lastHit: Float64Array; // per car: last contact with any car

  constructor(n: number) {
    this.n = n;
    this.passes = new Int32Array(n); this.lost = new Int32Array(n);
    this.faults = new Int32Array(n); this.crashFaults = new Int32Array(n);
    this.ahead = new Int8Array(n * n); this.flipT = new Float64Array(n * n).fill(-1);
    this.lastTouch = new Float64Array(n * n).fill(-1e9);
    this.faultedEp = new Uint8Array(n * n);
    this.lastFaultBy = new Int32Array(n).fill(-1); this.lastFaultT = new Float64Array(n).fill(-1e9);
    this.lastHit = new Float64Array(n).fill(-1e9);
  }

  step(dt: number, cars: ReadonlyArray<RaceCar>): void {
    if (this.t === 0) for (let k = 0; k < this.n; k++) for (let j = 0; j < this.n; j++) this.ahead[k * this.n + j] = cars[k].dist > cars[j].dist ? 1 : 0;
    this.t += dt;
    const n = this.n;
    for (let k = 0; k < n; k++) {
      for (let j = k + 1; j < n; j++) {
        const a = cars[k], b = cars[j], kj = k * n + j;
        const kAhead = a.dist > b.dist ? 1 : 0;
        if (kAhead === this.ahead[kj]) { this.flipT[kj] = -1; continue; }
        const ok = a.running && b.running && a.speed >= PASS_MIN_V && b.speed >= PASS_MIN_V
          && Math.min(a.speed, b.speed) >= PASS_REL_V * Math.max(a.speed, b.speed)
          && this.t - this.lastHit[k] > PASS_CLEAN_S && this.t - this.lastHit[j] > PASS_CLEAN_S;
        if (this.flipT[kj] < 0) {
          if (!ok || Math.abs(a.dist - b.dist) > PASS_GAP) { this.ahead[kj] = kAhead; this.ahead[j * n + k] = 1 - kAhead; continue; } // silent re-order
          this.flipT[kj] = this.t;
        }
        if (this.t - this.flipT[kj] >= PASS_HOLD - 1e-9) {
          this.ahead[kj] = kAhead; this.ahead[j * n + k] = 1 - kAhead; this.flipT[kj] = -1;
          if (kAhead) { this.passes[k]++; this.lost[j]++; } else { this.passes[j]++; this.lost[k]++; }
        }
      }
    }
  }

  // Called each step while chassis k and j touch, once per ordered pair; info = j in k's frame.
  contact(k: number, j: number, info: ContactInfo): void {
    const u = Math.min(k, j) * this.n + Math.max(k, j);
    if (this.t - this.lastTouch[u] > EPISODE_GAP) { this.faultedEp[k * this.n + j] = 0; this.faultedEp[j * this.n + k] = 0; }
    this.lastTouch[u] = this.t;
    this.lastHit[k] = this.t; this.lastHit[j] = this.t;
    const kj = k * this.n + j;
    if (this.faultedEp[kj]) return;
    if (info.fwdGap > 1.0 && Math.abs(info.latGap) < 1.2 && info.closing > FAULT_CLOSING) {
      this.faultedEp[kj] = 1;
      this.faults[k]++;
      this.lastFaultBy[j] = k; this.lastFaultT[j] = this.t;
    }
  }

  noteElimination(k: number): void {
    const f = this.lastFaultBy[k];
    if (f >= 0 && this.t - this.lastFaultT[k] <= CRASH_WINDOW) { this.crashFaults[f]++; this.lastFaultBy[k] = -1; }
  }

  // Test hook: advance time without position updates.
  tick(dt: number): void { this.t += dt; }
}

export function racecraftFitness(base: number, finishPos: number, n: number, passes: number, lost: number, faults: number, crashFaults: number): number {
  return base + POS_W * (n - 1 - finishPos) + PASS_W * (passes - lost) - CONTACT_W * faults - CRASH_W * crashFaults;
}

export function pickOpponents<T extends { avgLap: number }>(hof: readonly T[], bestAvg: number, count: number, rand: () => number): T[] {
  const ok = hof.filter((m) => m.avgLap <= bestAvg + 3);
  if (!ok.length) return [];
  return Array.from({ length: count }, () => ok[Math.floor(rand() * ok.length)]);
}

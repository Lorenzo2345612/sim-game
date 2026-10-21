// Racecraft scoring for the trainer (task 271): committed position changes, at-fault contacts, crash faults.
export const POS_W = 60, PASS_W = 40, CONTACT_W = 80, CRASH_W = 200;
// Trainer-tunable weights (--pass-w, --def-w): def rewards holding off a sustained attack.
export const RC_W = { pos: POS_W, pass: PASS_W, contact: CONTACT_W, crash: CRASH_W, def: 0, yellow: 0, incident: 0 };
// Incident (--incident-w): each spin (body sideslip > SPIN_SLIP rad above 5 m/s after it got going, 2 s debounce).
// Yellow (--yellow-w): a car slower than YEL_V after it got going, or just eliminated, waves yellow from YEL_BEHIND m before
// to YEL_AHEAD m past it, lingering YEL_LINGER s; passing a car other than the cause inside a zone is a yellow fault.
const YEL_V = 8, YEL_MOVED_V = 20, YEL_ELIM_S = 5, YEL_LINGER = 3, YEL_BEHIND = 150, YEL_AHEAD = 30;
const ATTACK_GAP = 12, ATTACK_HOLD = 2.0, ATTACK_RELEASE = 30; // m behind / s held / m gap that ends a defended attack
const PASS_GAP = 20, PASS_MIN_V = 2, PASS_HOLD = 1.0, PASS_REL_V = 0.8, PASS_CLEAN_S = 3.0; // no credit for passing a slow, crashed or just-hit car
const FAULT_CLOSING = 3.0, EPISODE_GAP = 0.5, CRASH_WINDOW = 3.0;

export interface ContactInfo { fwdGap: number; latGap: number; closing: number }
export interface RaceCar { dist: number; speed: number; running: boolean; slip?: number }
const SPIN_SLIP = 0.5, SPIN_DEBOUNCE = 2.0;

export class RacecraftTracker {
  readonly passes: Int32Array;
  readonly lost: Int32Array;
  readonly faults: Int32Array;
  readonly crashFaults: Int32Array;
  readonly defends: Int32Array;
  readonly yellowFaults: Int32Array;
  readonly incidents: Int32Array;
  readonly spins: Int32Array;
  private readonly spinUntil: Float64Array;
  private readonly yelUntil: Float64Array; // per car: yellow it causes is active until this time
  private readonly yelPos: Float64Array; // lap position of the cause
  private readonly moved: Uint8Array;
  private readonly elimT: Float64Array;
  private readonly lapLen: number;
  private readonly attackT: Float64Array; // per ordered pair (ahead*n+behind): start of the current attack (-1 none)
  private readonly armed: Uint8Array;
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
  // Optional order-change log (bench --log): counted passes and close silent re-orders with their cause.
  events: { t: number; winner: number; loser: number; kind: string; vw: number; vl: number }[] | null = null;

  constructor(n: number, lapLen = 0) {
    this.n = n; this.lapLen = lapLen;
    this.yellowFaults = new Int32Array(n); this.yelUntil = new Float64Array(n).fill(-1); this.yelPos = new Float64Array(n);
    this.incidents = new Int32Array(n); this.spins = new Int32Array(n); this.spinUntil = new Float64Array(n).fill(-1);
    this.moved = new Uint8Array(n); this.elimT = new Float64Array(n).fill(-1e9);
    this.passes = new Int32Array(n); this.lost = new Int32Array(n);
    this.faults = new Int32Array(n); this.crashFaults = new Int32Array(n);
    this.defends = new Int32Array(n); this.attackT = new Float64Array(n * n).fill(-1); this.armed = new Uint8Array(n * n);
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
    if (this.lapLen > 0) this.updateYellow(cars);
    for (let k = 0; k < n; k++) {
      for (let j = k + 1; j < n; j++) {
        const a = cars[k], b = cars[j], kj = k * n + j;
        const kAhead = a.dist > b.dist ? 1 : 0;
        this.attack(kAhead ? k : j, kAhead ? j : k, Math.abs(a.dist - b.dist), a.running && b.running);
        if (kAhead === this.ahead[kj]) { this.flipT[kj] = -1; continue; }
        const ok = a.running && b.running && a.speed >= PASS_MIN_V && b.speed >= PASS_MIN_V
          && Math.min(a.speed, b.speed) >= PASS_REL_V * Math.max(a.speed, b.speed)
          && this.t - this.lastHit[k] > PASS_CLEAN_S && this.t - this.lastHit[j] > PASS_CLEAN_S;
        if (this.flipT[kj] < 0) {
          if (this.lapLen > 0 && Math.abs(a.dist - b.dist) <= PASS_GAP) this.checkYellowPass(kAhead ? k : j, kAhead ? j : k, kAhead ? a : b, kAhead ? b : a);
          if (!ok || Math.abs(a.dist - b.dist) > PASS_GAP) {
            if (this.events && Math.abs(a.dist - b.dist) <= PASS_GAP) this.logFlip(kAhead ? k : j, kAhead ? j : k, cars);
            this.ahead[kj] = kAhead; this.ahead[j * n + k] = 1 - kAhead; continue;
          } // silent re-order
          this.flipT[kj] = this.t;
        }
        if (this.t - this.flipT[kj] >= PASS_HOLD - 1e-9) {
          this.ahead[kj] = kAhead; this.ahead[j * n + k] = 1 - kAhead; this.flipT[kj] = -1;
          if (kAhead) { this.passes[k]++; this.lost[j]++; } else { this.passes[j]++; this.lost[k]++; }
          if (this.events) { const w = kAhead ? k : j, l = kAhead ? j : k; this.events.push({ t: this.t, winner: w, loser: l, kind: 'pass', vw: cars[w].speed, vl: cars[l].speed }); }
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

  // Behind car within ATTACK_GAP for ATTACK_HOLD s arms an attack; it counts as defended when the gap
  // opens past ATTACK_RELEASE with the order unchanged. A pass (order flip) cancels the attack on the old pair.
  private attack(ahead: number, behind: number, gap: number, running: boolean): void {
    const n = this.n, ab = ahead * n + behind, ba = behind * n + ahead;
    this.attackT[ba] = -1; this.armed[ba] = 0;
    if (!running) { this.attackT[ab] = -1; this.armed[ab] = 0; return; }
    if (gap <= ATTACK_GAP) {
      if (this.attackT[ab] < 0) this.attackT[ab] = this.t;
      else if (this.t - this.attackT[ab] >= ATTACK_HOLD) this.armed[ab] = 1;
    } else if (gap > ATTACK_RELEASE) {
      if (this.armed[ab]) this.defends[ahead]++;
      this.attackT[ab] = -1; this.armed[ab] = 0;
    }
  }

  private lapPos(d: number): number { return ((d % this.lapLen) + this.lapLen) % this.lapLen; }

  private updateYellow(cars: ReadonlyArray<RaceCar>): void {
    for (let c = 0; c < this.n; c++) {
      const car = cars[c];
      if (car.speed > YEL_MOVED_V) this.moved[c] = 1;
      const cause = (car.running && this.moved[c] === 1 && car.speed < YEL_V) || this.t - this.elimT[c] <= YEL_ELIM_S;
      if (car.running && this.moved[c] === 1 && (car.slip ?? 0) > SPIN_SLIP) {
        if (this.spinUntil[c] < this.t) { this.incidents[c]++; this.spins[c]++; }
        this.spinUntil[c] = this.t + SPIN_DEBOUNCE;
      }
      if (cause) { this.yelUntil[c] = this.t + YEL_LINGER; this.yelPos[c] = this.lapPos(car.dist); }
    }
  }

  // passer just moved ahead of passed: fault when the passer is inside an active zone not caused by the passed car.
  private logFlip(w: number, l: number, cars: ReadonlyArray<RaceCar>): void {
    const a = cars[w], b = cars[l];
    const kind = !b.running ? 'out' : !a.running ? 'winner-out' : b.speed < PASS_MIN_V ? 'stopped'
      : Math.min(a.speed, b.speed) < PASS_REL_V * Math.max(a.speed, b.speed) ? 'slow'
      : this.t - this.lastHit[w] <= PASS_CLEAN_S || this.t - this.lastHit[l] <= PASS_CLEAN_S ? 'contact' : 'other';
    this.events!.push({ t: this.t, winner: w, loser: l, kind, vw: a.speed, vl: b.speed });
  }
  private checkYellowPass(passer: number, passed: number, pa: RaceCar, pb: RaceCar): void {
    if (!pa.running || !pb.running || this.yelUntil[passed] > this.t) return;
    const p = this.lapPos(pa.dist);
    for (let c = 0; c < this.n; c++) {
      if (c === passer || this.yelUntil[c] <= this.t) continue;
      const d = this.lapPos(this.yelPos[c] - p); // metres from the passer forward to the cause
      if (d <= YEL_BEHIND || this.lapLen - d <= YEL_AHEAD) { this.yellowFaults[passer]++; return; }
    }
  }

  noteElimination(k: number): void {
    this.elimT[k] = this.t;
    const f = this.lastFaultBy[k];
    if (f >= 0 && this.t - this.lastFaultT[k] <= CRASH_WINDOW) { this.crashFaults[f]++; this.lastFaultBy[k] = -1; }
  }

  // Test hook: advance time without position updates.
  tick(dt: number): void { this.t += dt; }
}

export function racecraftFitness(base: number, finishPos: number, n: number, passes: number, lost: number, faults: number, crashFaults: number, defends = 0, yellowFaults = 0, incidents = 0): number {
  return base + RC_W.pos * (n - 1 - finishPos) + RC_W.pass * (passes - lost) - RC_W.contact * faults - RC_W.crash * crashFaults + RC_W.def * defends - RC_W.yellow * yellowFaults - RC_W.incident * incidents;
}

export function pickOpponents<T extends { avgLap: number }>(hof: readonly T[], bestAvg: number, count: number, rand: () => number): T[] {
  const ok = hof.filter((m) => m.avgLap <= bestAvg + 3);
  if (!ok.length) return [];
  return Array.from({ length: count }, () => ok[Math.floor(rand() * ok.length)]);
}

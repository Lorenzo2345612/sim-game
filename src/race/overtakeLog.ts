export const PASS_GAP_M = 20;
export const PASS_HOLD_S = 1;
export const PASS_REL_V = 0.8;
export const PASS_MIN_V_MS = 2;
export const CONTACT_WINDOW_S = 3;

export type OvertakeKind = 'clean' | 'contact' | 'gift';

export interface OvertakeCar {
  dist: number;
  lapDist: number;
  lap: number;
  speed: number;
  running: boolean;
  position: number;
  lastContact: number;
}

export interface OvertakeEvent {
  t: number;
  lap: number;
  lapDistance: number;
  passer: number;
  passed: number;
  position: number;
  kind: OvertakeKind;
}

export interface OvertakeSummary {
  clean: number;
  contact: number;
  gift: number;
  lost: number;
}

// Committed position changes between two cars (task 290), same pass rule as the
// trainer's RacecraftTracker but classifying the pass instead of discarding it.
export class OvertakeLog {
  readonly events: OvertakeEvent[] = [];
  private readonly n: number;
  // Per unordered pair (i·n + j, i < j): 1 when i is ahead of j in the committed order.
  private readonly ahead: Uint8Array;
  // Pending flip start time per pair cell (−1 = none), like the trainer's.
  private readonly flipT: Float64Array;
  private readonly clean: Int32Array;
  private readonly contact: Int32Array;
  private readonly gift: Int32Array;
  private readonly lost: Int32Array;
  private initialised = false;

  constructor(n: number) {
    this.n = n;
    this.ahead = new Uint8Array(n * n);
    this.flipT = new Float64Array(n * n).fill(-1);
    this.clean = new Int32Array(n);
    this.contact = new Int32Array(n);
    this.gift = new Int32Array(n);
    this.lost = new Int32Array(n);
  }

  step(t: number, cars: readonly OvertakeCar[]): void {
    const n = this.n;
    if (!this.initialised) {
      this.initialised = true;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) this.ahead[i * n + j] = cars[i].dist > cars[j].dist ? 1 : 0;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ij = i * n + j;
        const kAhead = cars[i].dist > cars[j].dist ? 1 : 0;
        if (kAhead === this.ahead[ij]) {
          this.flipT[ij] = -1; // order reverted or held: drop any pending pass
          continue;
        }
        if (this.flipT[ij] < 0) {
          if (Math.abs(cars[i].dist - cars[j].dist) > PASS_GAP_M) {
            this.ahead[ij] = kAhead; // silent re-order, too far for a pass
            this.ahead[j * n + i] = 1 - kAhead;
            continue;
          }
          this.flipT[ij] = t;
        }
        const flipStart = this.flipT[ij];
        if (t - flipStart < PASS_HOLD_S - 1e-9) continue;
        this.ahead[ij] = kAhead;
        this.ahead[j * n + i] = 1 - kAhead;
        this.flipT[ij] = -1;
        const passer = kAhead ? i : j;
        const passed = kAhead ? j : i;
        this.commit(t, flipStart, passer, passed, cars[passer], cars[passed]);
      }
    }
  }

  summary(car: number): OvertakeSummary {
    if (!Number.isInteger(car) || car < 0 || car >= this.n) {
      throw new RangeError(`car ${car} out of range`);
    }
    return {
      clean: this.clean[car],
      contact: this.contact[car],
      gift: this.gift[car],
      lost: this.lost[car],
    };
  }

  private commit(
    t: number,
    flipStart: number,
    passer: number,
    passed: number,
    p: OvertakeCar,
    q: OvertakeCar,
  ): void {
    let kind: OvertakeKind;
    if (!q.running || q.speed < PASS_MIN_V_MS || q.speed < PASS_REL_V * p.speed) kind = 'gift';
    else if (p.lastContact >= flipStart - CONTACT_WINDOW_S || q.lastContact >= flipStart - CONTACT_WINDOW_S) {
      kind = 'contact';
    } else kind = 'clean';
    this.events.push({ t, lap: p.lap, lapDistance: p.lapDist, passer, passed, position: p.position, kind });
    if (kind === 'clean') this.clean[passer]++;
    else if (kind === 'contact') this.contact[passer]++;
    else this.gift[passer]++;
    this.lost[passed]++;
  }
}

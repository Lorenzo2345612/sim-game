export const GIVE_BACK_S = 10;
export const GIVE_BACK_PENALTY_S = 5;
const RETURNED_GRACE_S = 2;
const EPS = 1e-9;

export type GiveBackKind = 'returned' | 'void' | 'penalty';
export interface GiveBackEvent {
  car: number;
  passed: number;
  kind: GiveBackKind;
}

export class GiveBack {
  private readonly n: number;
  private readonly openAt: Float64Array;
  private readonly returnedAt: Float64Array;
  private events: GiveBackEvent[] = [];

  constructor(count: number) {
    this.n = count;
    this.openAt = new Float64Array(count * count).fill(Number.NaN);
    this.returnedAt = new Float64Array(count * count).fill(Number.NEGATIVE_INFINITY);
  }

  open(car: number, passed: number, time: number): void {
    const s = car * this.n + passed;
    if (!Number.isNaN(this.openAt[s])) return;
    this.openAt[s] = time;
  }

  update(distances: ArrayLike<number>, out: ArrayLike<boolean>, time: number): void {
    const n = this.n;
    for (let car = 0; car < n; car++) {
      for (let passed = 0; passed < n; passed++) {
        const s = car * n + passed;
        const t0 = this.openAt[s];
        if (Number.isNaN(t0)) continue;
        let kind: GiveBackKind | null = null;
        if (distances[car] < distances[passed]) kind = 'returned';
        else if (out[passed]) kind = 'void';
        else if (time >= t0 + GIVE_BACK_S - EPS) kind = 'penalty';
        if (kind === null) continue;
        this.openAt[s] = Number.NaN;
        if (kind === 'returned') this.returnedAt[s] = time;
        this.events.push({ car, passed, kind });
      }
    }
  }

  private oldest(car: number): number {
    let best = -1;
    let bestT = Infinity;
    for (let p = 0; p < this.n; p++) {
      const t0 = this.openAt[car * this.n + p];
      if (!Number.isNaN(t0) && t0 < bestT) {
        bestT = t0;
        best = p;
      }
    }
    return best;
  }

  owes(car: number): number {
    return this.oldest(car);
  }

  remaining(car: number, time: number): number {
    const p = this.oldest(car);
    return p < 0 ? Number.NaN : this.openAt[car * this.n + p] + GIVE_BACK_S - time;
  }

  drainEvents(): GiveBackEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isGiveBack(car: number, passed: number, time: number): boolean {
    const s = passed * this.n + car;
    return !Number.isNaN(this.openAt[s]) || time - this.returnedAt[s] <= RETURNED_GRACE_S + EPS;
  }
}

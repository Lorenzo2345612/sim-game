export type PenaltyReason = 'track limits' | 'yellow flag overtake' | 'VSC delta' | 'jump start';

export type PenaltyOutcome = 'ok' | 'final-warning' | 'black-flag';

export interface PenaltyLimits {
  maxPerReason: number;
  maxTotal: number;
}

export const DEFAULT_PENALTY_LIMITS: PenaltyLimits = { maxPerReason: 3, maxTotal: 5 };

export interface PenaltyEntry {
  car: number;
  kind: 'warning' | 'penalty' | 'black flag';
  seconds: number;
  reason: PenaltyReason;
  time: number;
  finalWarning?: true;
}

function checkLimit(name: string, value: number): void {
  if (!(value === Infinity || (Number.isInteger(value) && value >= 1))) {
    throw new RangeError(`${name} must be an integer >= 1 or Infinity: ${value}`);
  }
}

export class PenaltyBook {
  private readonly list: PenaltyEntry[] = [];
  private readonly perCar: PenaltyEntry[][];
  private readonly totals: Float64Array;
  private readonly limits: PenaltyLimits;
  private readonly penaltyCounts: number[];
  private readonly reasonCounts: Record<PenaltyReason, number>[];
  private readonly blackFlagged: boolean[];

  constructor(carCount: number, limits?: Partial<PenaltyLimits>) {
    this.perCar = [];
    this.penaltyCounts = [];
    this.reasonCounts = [];
    this.blackFlagged = [];
    for (let i = 0; i < carCount; i++) {
      this.perCar.push([]);
      this.penaltyCounts.push(0);
      this.reasonCounts.push({ 'track limits': 0, 'yellow flag overtake': 0, 'VSC delta': 0, 'jump start': 0 });
      this.blackFlagged.push(false);
    }
    this.totals = new Float64Array(carCount);
    this.limits = {
      maxPerReason: limits?.maxPerReason ?? DEFAULT_PENALTY_LIMITS.maxPerReason,
      maxTotal: limits?.maxTotal ?? DEFAULT_PENALTY_LIMITS.maxTotal,
    };
    checkLimit('maxPerReason', this.limits.maxPerReason);
    checkLimit('maxTotal', this.limits.maxTotal);
  }

  add(car: number, kind: 'warning' | 'penalty', seconds: number, reason: PenaltyReason, time: number): PenaltyOutcome {
    this.check(car);
    if (this.blackFlagged[car]) return 'black-flag';
    if (kind === 'warning') {
      this.record({ car, kind, seconds: 0, reason, time });
      return 'ok';
    }
    const total = this.penaltyCounts[car] + 1;
    const perReason = this.reasonCounts[car][reason] + 1;
    let outcome: PenaltyOutcome;
    if (total > this.limits.maxTotal || perReason > this.limits.maxPerReason) outcome = 'black-flag';
    else if (total === this.limits.maxTotal || perReason === this.limits.maxPerReason) outcome = 'final-warning';
    else outcome = 'ok';
    if (outcome === 'black-flag') {
      this.record({ car, kind: 'black flag', seconds: 0, reason, time });
      this.blackFlagged[car] = true;
      return outcome;
    }
    const entry: PenaltyEntry = { car, kind: 'penalty', seconds, reason, time };
    if (outcome === 'final-warning') entry.finalWarning = true;
    this.record(entry);
    this.penaltyCounts[car] = total;
    this.reasonCounts[car][reason] = perReason;
    this.totals[car] += seconds;
    return outcome;
  }

  count(car: number, reason?: PenaltyReason): number {
    this.check(car);
    return reason === undefined ? this.penaltyCounts[car] : this.reasonCounts[car][reason];
  }

  isBlackFlagged(car: number): boolean {
    this.check(car);
    return this.blackFlagged[car];
  }

  total(car: number): number {
    this.check(car);
    return this.totals[car];
  }

  entries(): readonly PenaltyEntry[] {
    return this.list;
  }

  forCar(car: number): readonly PenaltyEntry[] {
    this.check(car);
    return this.perCar[car];
  }

  private record(entry: PenaltyEntry): void {
    this.list.push(entry);
    this.perCar[entry.car].push(entry);
  }

  private check(car: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.perCar.length) {
      throw new RangeError(`car out of range: ${car}`);
    }
  }
}

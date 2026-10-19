export type PenaltyReason = 'track limits' | 'yellow flag overtake' | 'VSC delta' | 'jump start';

export interface PenaltyEntry {
  car: number;
  kind: 'warning' | 'penalty';
  seconds: number;
  reason: PenaltyReason;
  time: number;
}

export class PenaltyBook {
  private readonly list: PenaltyEntry[] = [];
  private readonly perCar: PenaltyEntry[][];
  private readonly totals: Float64Array;

  constructor(carCount: number) {
    this.perCar = [];
    for (let i = 0; i < carCount; i++) this.perCar.push([]);
    this.totals = new Float64Array(carCount);
  }

  add(car: number, kind: 'warning' | 'penalty', seconds: number, reason: PenaltyReason, time: number): void {
    this.check(car);
    const entry: PenaltyEntry = {
      car,
      kind,
      seconds: kind === 'penalty' ? seconds : 0,
      reason,
      time,
    };
    this.list.push(entry);
    this.perCar[car].push(entry);
    if (kind === 'penalty') this.totals[car] += seconds;
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

  private check(car: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.perCar.length) {
      throw new RangeError(`car out of range: ${car}`);
    }
  }
}

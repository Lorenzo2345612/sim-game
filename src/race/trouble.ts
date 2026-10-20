export const TROUBLE_HOLD_S = 10;
const CAUSE_SPEED = 5;

export class TroubleTracker {
  private readonly lastMark: Float64Array;

  constructor(count: number) {
    this.lastMark = new Float64Array(count).fill(Number.NEGATIVE_INFINITY);
  }

  mark(car: number, time: number): void {
    this.lastMark[car] = time;
  }

  update(car: number, offTrack: boolean, speed: number, time: number): void {
    if (offTrack || speed < CAUSE_SPEED) this.lastMark[car] = time;
  }

  inTrouble(car: number, time: number): boolean {
    return time < this.lastMark[car] + TROUBLE_HOLD_S;
  }
}

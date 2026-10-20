export interface FlagCar {
  distance: number;
  lapDistance: number;
  speed: number;
  offTrack: boolean;
  retired: boolean;
}

export type SectorFlag = 'green' | 'yellow' | 'double-yellow';

const CAUSE_SPEED = 5; // m/s
const YELLOW_AFTER = 1; // s of continuous cause
const DOUBLE_AFTER = 3; // s of continuous on-track stop
const DECAY = 2; // s after the last seen cause
const BLUE_WINDOW = 200; // m behind on track
export const START_GRACE_S = 8; // s after go where a not-yet-launched car is not a yellow cause

export interface FlagOptions {
  minYellowS?: number;
  causeGapS?: number;
  countdownS?: number;
}

export const RACE_MIN_YELLOW_S = 10;
export const RACE_CAUSE_GAP_S = 2;
export const RACE_COUNTDOWN_S = 3;

export class FlagState {
  readonly minYellowS: number;
  readonly causeGapS: number;
  readonly countdownS: number;
  private readonly onset = [Number.NaN, Number.NaN, Number.NaN];
  private readonly cdStart = [Number.NaN, Number.NaN, Number.NaN];
  private readonly yellowFree: number[] = [];
  private readonly doubleFree: number[] = [];
  private readonly bounds: readonly [number, number, number];
  private readonly lapLength: number;
  private readonly lastYellow = [-Infinity, -Infinity, -Infinity];
  private readonly lastDouble = [-Infinity, -Infinity, -Infinity];
  private time = Number.NaN;
  private count = 0;
  private readonly dist: number[] = [];
  private readonly lapDist: number[] = [];
  private readonly retired: boolean[] = [];
  private readonly valid: boolean[] = [];
  private readonly sector: number[] = [];
  private readonly yellowFrom: number[] = [];
  private readonly doubleFrom: number[] = [];
  private readonly prevDist: number[] = [];
  private readonly hadPrev: boolean[] = [];
  private pendOvertaker: number[] = [];
  private pendPassed: number[] = [];
  private graceUntil = -Infinity;
  private readonly launched: boolean[] = [];

  constructor(sectorBounds: [number, number, number], lapLength: number, options: FlagOptions = {}) {
    this.minYellowS = options.minYellowS ?? 0;
    this.causeGapS = options.causeGapS ?? 0;
    this.countdownS = options.countdownS ?? 0;
    this.bounds = [sectorBounds[0], sectorBounds[1], sectorBounds[2]];
    this.lapLength = lapLength;
  }

  startAt(goTime: number): void {
    this.graceUntil = goTime + START_GRACE_S;
  }

  update(cars: readonly FlagCar[], time: number): void {
    if (!Number.isFinite(time) || time < this.time) return;
    const n = cars.length;
    this.grow(n);
    if (n !== this.count) {
      for (let i = 0; i < this.hadPrev.length; i++) this.hadPrev[i] = false;
    }
    const first = Number.isNaN(this.time);
    this.time = time;
    const inGrace = time < this.graceUntil;
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const ok = Number.isFinite(c.distance) && Number.isFinite(c.lapDistance) && Number.isFinite(c.speed);
      this.valid[i] = ok;
      if (!ok) {
        this.yellowFrom[i] = Number.NaN;
        this.doubleFrom[i] = Number.NaN;
        this.yellowFree[i] = Number.NaN;
        this.doubleFree[i] = Number.NaN;
        continue;
      }
      this.dist[i] = c.distance;
      this.lapDist[i] = c.lapDistance;
      this.retired[i] = c.retired;
      const s = this.sectorOf(c.lapDistance);
      this.sector[i] = s;
      const slow = c.speed < CAUSE_SPEED;
      if (!slow) this.launched[i] = true;
      // The grace covers grid cars that never got going; a stall after the launch is a cause.
      const grace = inGrace && !this.launched[i];
      if (c.offTrack || (slow && !grace)) {
        if (Number.isNaN(this.yellowFrom[i])) this.yellowFrom[i] = time;
        this.yellowFree[i] = Number.NaN;
        if (time - this.yellowFrom[i] >= YELLOW_AFTER) this.lastYellow[s] = time;
      } else if (!Number.isNaN(this.yellowFrom[i])) {
        if (Number.isNaN(this.yellowFree[i])) this.yellowFree[i] = time;
        if (time - this.yellowFree[i] >= this.causeGapS) this.yellowFrom[i] = Number.NaN;
      }
      if (slow && !c.offTrack && !grace) {
        if (Number.isNaN(this.doubleFrom[i])) this.doubleFrom[i] = time;
        this.doubleFree[i] = Number.NaN;
        if (time - this.doubleFrom[i] >= DOUBLE_AFTER) this.lastDouble[s] = time;
      } else if (!Number.isNaN(this.doubleFrom[i])) {
        if (Number.isNaN(this.doubleFree[i])) this.doubleFree[i] = time;
        if (time - this.doubleFree[i] >= this.causeGapS) this.doubleFrom[i] = Number.NaN;
      }
    }
    for (let k = 0; k < 3; k++) {
      const raw = this.rawFlagOf(k);
      if (!Number.isNaN(this.cdStart[k])) {
        if (raw === 'green') {
          this.cdStart[k] = Number.NaN;
        } else if (time - this.cdStart[k] >= this.countdownS) {
          this.cdStart[k] = Number.NaN;
          if (Number.isNaN(this.onset[k])) this.onset[k] = time;
        }
      }
      if (!Number.isNaN(this.cdStart[k])) continue;
      if (raw !== 'green') {
        if (Number.isNaN(this.onset[k])) {
          if (this.countdownS > 0) this.cdStart[k] = time;
          else this.onset[k] = time;
        }
      } else if (!(time - this.onset[k] < this.minYellowS)) {
        this.onset[k] = Number.NaN;
      }
    }
    if (!first) this.detectOvertakes(n);
    for (let i = 0; i < n; i++) {
      this.hadPrev[i] = this.valid[i];
      if (this.valid[i]) this.prevDist[i] = this.dist[i];
    }
    this.count = n;
  }

  sectorFlag(sector: number): SectorFlag {
    if (sector !== 1 && sector !== 2 && sector !== 3) {
      throw new RangeError(`sector ${sector} out of range`);
    }
    return this.flagOf(sector - 1);
  }

  sectorCountdown(sector: number): number {
    if (sector !== 1 && sector !== 2 && sector !== 3) {
      throw new RangeError(`sector ${sector} out of range`);
    }
    const start = this.cdStart[sector - 1];
    if (Number.isNaN(start)) return Number.NaN;
    const left = start + this.countdownS - this.time;
    return left > 0 ? left : Number.NaN;
  }

  blueFor(car: number): boolean {
    return this.blueLapper(car) !== -1;
  }

  blueLapper(car: number): number {
    if (!Number.isInteger(car) || car < 0 || car >= this.count) {
      throw new RangeError(`car ${car} out of range`);
    }
    if (this.retired[car]) return -1;
    const half = this.lapLength / 2;
    const L = this.lapLength;
    const xd = this.dist[car];
    const xl = this.lapDist[car];
    let best = -1;
    let bestGap = Infinity;
    for (let j = 0; j < this.count; j++) {
      if (j === car || this.retired[j] || !this.valid[j]) continue;
      if (this.dist[j] - xd <= half) continue;
      const behind = ((xl - this.lapDist[j]) % L + L) % L;
      if (behind <= BLUE_WINDOW && behind < bestGap) {
        bestGap = behind;
        best = j;
      }
    }
    return best;
  }

  overtakeUnderYellow(): { car: number; passed: number }[] {
    const out: { car: number; passed: number }[] = [];
    for (let k = 0; k < this.pendOvertaker.length; k++) {
      out.push({ car: this.pendOvertaker[k], passed: this.pendPassed[k] });
    }
    out.sort((a, b) => a.car - b.car || a.passed - b.passed);
    this.pendOvertaker.length = 0;
    this.pendPassed.length = 0;
    return out;
  }

  private grow(n: number): void {
    while (this.dist.length < n) {
      this.dist.push(Number.NaN);
      this.lapDist.push(Number.NaN);
      this.retired.push(false);
      this.valid.push(false);
      this.sector.push(0);
      this.yellowFrom.push(Number.NaN);
      this.doubleFrom.push(Number.NaN);
      this.yellowFree.push(Number.NaN);
      this.doubleFree.push(Number.NaN);
      this.prevDist.push(Number.NaN);
      this.hadPrev.push(false);
      this.launched.push(false);
    }
  }

  private sectorOf(lapDistance: number): number {
    const b = this.bounds;
    if (lapDistance >= b[2]) return 2;
    if (lapDistance >= b[1]) return 1;
    return 0;
  }

  private rawFlagOf(sector: number): SectorFlag {
    if (this.time - this.lastDouble[sector] < DECAY) return 'double-yellow';
    if (this.time - this.lastYellow[sector] < DECAY) return 'yellow';
    return 'green';
  }

  private flagOf(sector: number): SectorFlag {
    if (!Number.isNaN(this.cdStart[sector])) return 'green';
    const raw = this.rawFlagOf(sector);
    if (raw === 'green' && this.time - this.onset[sector] < this.minYellowS) return 'yellow';
    return raw;
  }

  private detectOvertakes(n: number): void {
    for (let i = 0; i < n; i++) {
      if (!this.valid[i] || !this.hadPrev[i] || this.retired[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!this.valid[j] || !this.hadPrev[j] || this.retired[j]) continue;
        const before = this.prevDist[i] - this.prevDist[j];
        const now = this.dist[i] - this.dist[j];
        if (before === 0 || now === 0 || (before > 0) === (now > 0)) continue;
        if (this.flagOf(this.sector[i]) === 'green' || this.flagOf(this.sector[j]) === 'green') continue;
        this.pendOvertaker.push(before > 0 ? j : i);
        this.pendPassed.push(before > 0 ? i : j);
      }
    }
  }
}

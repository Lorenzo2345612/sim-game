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

export class FlagState {
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

  constructor(sectorBounds: [number, number, number], lapLength: number) {
    this.bounds = [sectorBounds[0], sectorBounds[1], sectorBounds[2]];
    this.lapLength = lapLength;
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
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      const ok = Number.isFinite(c.distance) && Number.isFinite(c.lapDistance) && Number.isFinite(c.speed);
      this.valid[i] = ok;
      if (!ok) {
        this.yellowFrom[i] = Number.NaN;
        this.doubleFrom[i] = Number.NaN;
        continue;
      }
      this.dist[i] = c.distance;
      this.lapDist[i] = c.lapDistance;
      this.retired[i] = c.retired;
      const s = this.sectorOf(c.lapDistance);
      this.sector[i] = s;
      if (c.offTrack || c.speed < CAUSE_SPEED) {
        if (Number.isNaN(this.yellowFrom[i])) this.yellowFrom[i] = time;
        if (time - this.yellowFrom[i] >= YELLOW_AFTER) this.lastYellow[s] = time;
      } else {
        this.yellowFrom[i] = Number.NaN;
      }
      if (c.speed < CAUSE_SPEED && !c.offTrack) {
        if (Number.isNaN(this.doubleFrom[i])) this.doubleFrom[i] = time;
        if (time - this.doubleFrom[i] >= DOUBLE_AFTER) this.lastDouble[s] = time;
      } else {
        this.doubleFrom[i] = Number.NaN;
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

  blueFor(car: number): boolean {
    if (!Number.isInteger(car) || car < 0 || car >= this.count) {
      throw new RangeError(`car ${car} out of range`);
    }
    if (this.retired[car]) return false;
    const half = this.lapLength / 2;
    const L = this.lapLength;
    const xd = this.dist[car];
    const xl = this.lapDist[car];
    for (let j = 0; j < this.count; j++) {
      if (j === car || this.retired[j] || !this.valid[j]) continue;
      if (this.dist[j] - xd <= half) continue;
      const behind = ((xl - this.lapDist[j]) % L + L) % L;
      if (behind <= BLUE_WINDOW) return true;
    }
    return false;
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
      this.prevDist.push(Number.NaN);
      this.hadPrev.push(false);
    }
  }

  private sectorOf(lapDistance: number): number {
    const b = this.bounds;
    if (lapDistance >= b[2]) return 2;
    if (lapDistance >= b[1]) return 1;
    return 0;
  }

  private flagOf(sector: number): SectorFlag {
    if (this.time - this.lastDouble[sector] < DECAY) return 'double-yellow';
    if (this.time - this.lastYellow[sector] < DECAY) return 'yellow';
    return 'green';
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

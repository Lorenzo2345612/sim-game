import type { LapEvent } from '../core/types';

const WRAP = 50; // m

export class LapTimer {
  private readonly lengthMeters: number;
  private readonly sectorStartDistances: [number, number, number];
  private prevDistance: number | null = null;
  private currentLap = 0;
  private lapStart = 0;
  private sectorStart = 0;
  private nextSector = 1;
  private invalid = false;
  private lastLap: number | null = null;
  private bestLap: number | null = null;

  constructor(lengthMeters: number, sectorStartDistances: [number, number, number]) {
    this.lengthMeters = lengthMeters;
    this.sectorStartDistances = sectorStartDistances;
  }

  get lap(): number { return this.currentLap; }
  get lastLapTime(): number | null { return this.lastLap; }
  get bestLapTime(): number | null { return this.bestLap; }

  update(distance: number, time: number): LapEvent[] {
    if (!Number.isFinite(distance) || !Number.isFinite(time)) return [];
    const L = this.lengthMeters;
    if (distance < 0 || distance >= L) return [];
    const events: LapEvent[] = [];
    const prev = this.prevDistance;
    this.prevDistance = distance;
    if (prev === null) return events;
    const forward = prev > L - WRAP && distance < WRAP;
    const backward = prev < WRAP && distance > L - WRAP;
    if (backward) {
      if (this.currentLap >= 1) this.invalid = true;
      return events;
    }
    if (forward) {
      if (this.currentLap === 0) {
        this.currentLap = 1;
        this.lapStart = time;
        this.sectorStart = time;
        this.nextSector = 1;
        this.invalid = false;
        events.push({ type: 'lapStarted', lap: 1, time });
        return events;
      }
      const valid = !this.invalid && this.nextSector === 3;
      if (valid) {
        events.push({
          type: 'sectorCompleted',
          lap: this.currentLap,
          sector: 3,
          sectorTime: time - this.sectorStart,
        });
        const lapTime = time - this.lapStart;
        const isBest = this.bestLap === null || lapTime < this.bestLap;
        this.lastLap = lapTime;
        if (isBest) this.bestLap = lapTime;
        events.push({ type: 'lapCompleted', lap: this.currentLap, lapTime, isBest });
      }
      this.currentLap += 1;
      this.lapStart = time;
      this.sectorStart = time;
      this.nextSector = 1;
      this.invalid = false;
      events.push({ type: 'lapStarted', lap: this.currentLap, time });
      return events;
    }
    if (this.currentLap >= 1) {
      while (this.nextSector <= 2) {
        const s = this.sectorStartDistances[this.nextSector];
        if (prev < s && s <= distance) {
          events.push({
            type: 'sectorCompleted',
            lap: this.currentLap,
            sector: this.nextSector,
            sectorTime: time - this.sectorStart,
          });
          this.sectorStart = time;
          this.nextSector += 1;
        } else {
          break;
        }
      }
    }
    return events;
  }

  currentLapTime(time: number): number | null {
    return this.currentLap >= 1 ? time - this.lapStart : null;
  }

  reset(): void {
    this.prevDistance = null;
    this.currentLap = 0;
    this.lapStart = 0;
    this.sectorStart = 0;
    this.nextSector = 1;
    this.invalid = false;
    this.lastLap = null;
    this.bestLap = null;
  }
}

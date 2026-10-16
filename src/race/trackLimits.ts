import type { Surface } from '../core/types';

export type TrackLimitEvent = { type: 'warning'; count: number } | { type: 'penalty'; seconds: number };

export interface TrackLimitsOptions {
  warnings: number;
  penalty: number;
  minOffSeconds: number;
}

export const DEFAULT_TRACK_LIMITS: TrackLimitsOptions = {
  warnings: 3,
  penalty: 5,
  minOffSeconds: 0.25,
};

// Fixed-step float sums land a few ulps below exact boundaries (see StartSequence).
const EPS = 1e-9;
const REARM_SECONDS = 1;

export function countWheelsOff(surfaces: readonly Surface[]): number {
  let n = 0;
  for (const s of surfaces) {
    if (s === 'grass' || s === 'gravel' || s === 'runoff') n++;
  }
  return n;
}

interface CarState {
  strikes: number;
  inExcursion: boolean;
  struck: boolean;
  excursionStart: number;
  onSince: number | null;
  lastTime: number | null;
}

export class TrackLimits {
  private readonly cars: CarState[];
  private readonly opts: TrackLimitsOptions;

  constructor(carCount: number, opts?: Partial<TrackLimitsOptions>) {
    this.opts = { ...DEFAULT_TRACK_LIMITS, ...opts };
    this.cars = [];
    for (let i = 0; i < carCount; i++) {
      this.cars.push({
        strikes: 0,
        inExcursion: false,
        struck: false,
        excursionStart: 0,
        onSince: null,
        lastTime: null,
      });
    }
  }

  update(car: number, wheelsOff: number, time: number): TrackLimitEvent | null {
    const s = this.state(car);
    const off = Number.isFinite(wheelsOff) ? Math.min(4, Math.max(0, wheelsOff)) : 0;
    const transition = s.lastTime ?? time;
    let event: TrackLimitEvent | null = null;
    if (off === 4) {
      if (!s.inExcursion) {
        s.inExcursion = true;
        s.struck = false;
        s.excursionStart = transition;
      }
      s.onSince = null;
      if (!s.struck && time - s.excursionStart >= this.opts.minOffSeconds - EPS) {
        s.struck = true;
        event = this.register(s);
      }
    } else if (s.inExcursion) {
      if (!s.struck) {
        s.inExcursion = false;
      } else {
        if (s.onSince === null) s.onSince = transition;
        if (time - s.onSince >= REARM_SECONDS - EPS) {
          s.inExcursion = false;
          s.struck = false;
          s.onSince = null;
        }
      }
    }
    s.lastTime = time;
    return event;
  }

  forceStrike(car: number): TrackLimitEvent {
    return this.register(this.state(car));
  }

  strikes(car: number): number {
    return this.state(car).strikes;
  }

  private state(car: number): CarState {
    if (!Number.isInteger(car) || car < 0 || car >= this.cars.length) {
      throw new RangeError(`car out of range: ${car}`);
    }
    return this.cars[car];
  }

  private register(s: CarState): TrackLimitEvent {
    s.strikes++;
    return s.strikes <= this.opts.warnings
      ? { type: 'warning', count: s.strikes }
      : { type: 'penalty', seconds: this.opts.penalty };
  }
}

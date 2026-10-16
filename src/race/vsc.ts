export type VscPhase = 'off' | 'deployed' | 'ending';

export interface VscEvent {
  car: number;
  seconds: 5;
}

const DEPLOY_SECONDS = 10;
const END_SECONDS = 5;
const PACE = 0.6; // × profile speed
const TOO_FAST_LIMIT = 2; // s accumulated with delta < 0 before the +5 s event

interface CarState {
  hasPrev: boolean;
  startTime: number;
  prevTime: number;
  prevDist: number;
  refTime: number;
  tooFast: number;
  penalized: boolean;
  lastDelta: number;
}

function freshCar(): CarState {
  return {
    hasPrev: false,
    startTime: 0,
    prevTime: 0,
    prevDist: 0,
    refTime: 0,
    tooFast: 0,
    penalized: false,
    lastDelta: 0,
  };
}

export class Vsc {
  private readonly speeds: Float64Array;
  private readonly dist: Float64Array;
  private readonly lapLength: number;
  private readonly cars: CarState[];
  private phaseValue: VscPhase = 'off';
  private clearTime = 0;
  private events: VscEvent[] = [];

  constructor(speeds: Float64Array, dist: Float64Array, lapLength: number, carCount: number) {
    if (speeds.length === 0) throw new Error('Vsc: empty profile');
    if (speeds.length !== dist.length) throw new Error('Vsc: speeds and dist length mismatch');
    this.speeds = speeds;
    this.dist = dist;
    this.lapLength = lapLength;
    this.cars = [];
    for (let i = 0; i < carCount; i++) this.cars.push(freshCar());
  }

  get phase(): VscPhase {
    return this.phaseValue;
  }

  update(stoppedOnTrackSeconds: number, time: number): void {
    if (this.phaseValue === 'off') {
      if (stoppedOnTrackSeconds >= DEPLOY_SECONDS) this.phaseValue = 'deployed';
      return;
    }
    if (this.phaseValue === 'deployed') {
      if (stoppedOnTrackSeconds === 0) {
        this.clearTime = time;
        this.phaseValue = 'ending';
      }
      return;
    }
    // ending: any cause reappears, otherwise off 5 s after the clear
    if (stoppedOnTrackSeconds > 0) {
      this.phaseValue = 'deployed';
    } else if (time - this.clearTime >= END_SECONDS) {
      this.phaseValue = 'off';
      for (let i = 0; i < this.cars.length; i++) this.cars[i] = freshCar();
    }
  }

  delta(car: number, lapDistance: number, time: number): number {
    this.check(car);
    if (this.phaseValue === 'off') return 0;
    const st = this.cars[car];
    if (!Number.isFinite(lapDistance) || !Number.isFinite(time)) return st.lastDelta;
    if (!st.hasPrev) {
      st.hasPrev = true;
      st.startTime = time;
      st.prevTime = time;
      st.prevDist = lapDistance;
      st.lastDelta = 0;
      return 0;
    }
    let d = lapDistance - st.prevDist;
    if (d < -0.5 * this.lapLength) d += this.lapLength;
    else if (d > 0.5 * this.lapLength) d -= this.lapLength;
    if (d > 0) st.refTime += d / (PACE * this.refSpeed(lapDistance));
    st.prevDist = lapDistance;
    const delta = time - st.startTime - st.refTime;
    st.lastDelta = delta;
    if (delta < 0) {
      st.tooFast += time - st.prevTime;
      if (st.tooFast > TOO_FAST_LIMIT && !st.penalized) {
        st.penalized = true;
        this.events.push({ car, seconds: 5 });
      }
    }
    st.prevTime = time;
    return delta;
  }

  drainEvents(): VscEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private check(car: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.cars.length) {
      throw new RangeError(`car ${car} out of range`);
    }
  }

  private refSpeed(lapDistance: number): number {
    const dist = this.dist;
    const n = dist.length;
    let s = lapDistance - dist[0];
    s -= Math.floor(s / this.lapLength) * this.lapLength;
    s += dist[0];
    if (s >= dist[n - 1]) {
      const span = dist[0] + this.lapLength - dist[n - 1];
      const t = span > 0 ? (s - dist[n - 1]) / span : 0;
      return this.speeds[n - 1] + (this.speeds[0] - this.speeds[n - 1]) * t;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (dist[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = dist[lo + 1] - dist[lo];
    const t = span > 0 ? (s - dist[lo]) / span : 0;
    return this.speeds[lo] + (this.speeds[lo + 1] - this.speeds[lo]) * t;
  }
}

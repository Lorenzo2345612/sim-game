export const QUALI_GRACE_S = 300;
export const OFF_LIMIT_S = 0.25;

export interface QualiStanding {
  car: number;
  position: number;
  bestLap: number | null;
  laps: number;
  lastLap: number | null;
  lastValid: boolean | null;
  done: boolean;
}

interface CarState {
  s: QualiStanding;
  hasPrev: boolean;
  prevDist: number;
  lapStart: number | null;
  bestSetTime: number;
  offAcc: number;
  lapInvalid: boolean;
}

export class QualifyingClassification {
  readonly lapLength: number;
  readonly durationS: number;
  private readonly cars: CarState[];
  private readonly rows: QualiStanding[];

  constructor(carCount: number, lapLength: number, durationS: number) {
    this.lapLength = lapLength;
    this.durationS = durationS;
    this.cars = [];
    this.rows = [];
    for (let i = 0; i < carCount; i++) {
      const s: QualiStanding = {
        car: i,
        position: i + 1,
        bestLap: null,
        laps: 0,
        lastLap: null,
        lastValid: null,
        done: false,
      };
      this.cars.push({ s, hasPrev: false, prevDist: 0, lapStart: null, bestSetTime: 0, offAcc: 0, lapInvalid: false });
      this.rows.push(s);
    }
  }

  get finished(): boolean {
    for (const st of this.cars) if (!st.s.done) return false;
    return true;
  }

  update(car: number, lapDistance: number, time: number, wheelsOff: number, dt: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.cars.length) return;
    const st = this.cars[car];
    if (!st.s.done) {
      if (wheelsOff >= 4) {
        st.offAcc += dt;
        if (st.offAcc >= OFF_LIMIT_S) st.lapInvalid = true;
      } else {
        st.offAcc = 0;
      }
      if (st.hasPrev) {
        const half = 0.5 * this.lapLength;
        const delta = lapDistance - st.prevDist;
        if (delta < -half) this.cross(st, time);
        else if (delta > half) st.lapStart = null;
      }
      st.prevDist = lapDistance;
      st.hasPrev = true;
    }
    if (time >= this.durationS + QUALI_GRACE_S) this.endSession();
  }

  retire(car: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.cars.length) return;
    this.cars[car].s.done = true;
  }

  standings(): QualiStanding[] {
    this.rows.sort((a, b) => {
      const ba = a.bestLap;
      const bb = b.bestLap;
      if (ba === null || bb === null) {
        if (ba !== bb) return ba === null ? 1 : -1;
        return a.car - b.car;
      }
      if (ba !== bb) return ba - bb;
      const ta = this.cars[a.car].bestSetTime;
      const tb = this.cars[b.car].bestSetTime;
      if (ta !== tb) return ta - tb;
      return a.car - b.car;
    });
    for (let i = 0; i < this.rows.length; i++) this.rows[i].position = i + 1;
    return this.rows;
  }

  private cross(st: CarState, time: number): void {
    const start = st.lapStart;
    if (time >= this.durationS) {
      if (start !== null) this.recordLap(st, start, time);
      st.s.done = true;
      return;
    }
    if (start === null) st.lapStart = time;
    else {
      this.recordLap(st, start, time);
      st.lapStart = time;
    }
    st.lapInvalid = false;
    st.offAcc = 0;
  }

  private recordLap(st: CarState, start: number, time: number): void {
    const s = st.s;
    const lt = time - start;
    s.laps += 1;
    s.lastLap = lt;
    s.lastValid = !st.lapInvalid;
    if (s.lastValid && (s.bestLap === null || lt < s.bestLap)) {
      s.bestLap = lt;
      st.bestSetTime = time;
    }
  }

  private endSession(): void {
    for (const st of this.cars) st.s.done = true;
  }
}

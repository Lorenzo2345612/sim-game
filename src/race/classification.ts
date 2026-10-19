export interface Standing {
  car: number;
  position: number;
  lap: number;
  distance: number;
  finished: boolean;
  totalTime: number | null;
  penalty: number;
  gapToLeader: number | null;
  lastLap: number | null;
  bestLap: number | null;
}

const GAP_MARK = 50; // m between leader history samples

interface CarState {
  s: Standing;
  prevDist: number;
  prevTime: number;
  hasPrev: boolean;
  stale: boolean;
  prevRaceDist: number;
  lapStart: number | null;
  accSinceCross: number;
  maxSinceCross: number;
  retired: boolean;
  retireSeq: number;
  disq: boolean;
  disqSeq: number;
  lastTime: number;
  nextMark: number;
  histDist: number[];
  histTime: number[];
}

function leaderTimeAt(st: CarState, dist: number): number | null {
  const hd = st.histDist;
  const n = hd.length;
  if (n === 0 || dist < hd[0] || dist > hd[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (hd[mid] <= dist) lo = mid;
    else hi = mid;
  }
  if (hd[lo] === dist) return st.histTime[lo];
  const span = hd[hi] - hd[lo];
  const t0 = st.histTime[lo];
  return span > 0 ? t0 + ((dist - hd[lo]) / span) * (st.histTime[hi] - t0) : t0;
}

export class RaceClassification {
  readonly laps: number;
  readonly lapLength: number;
  private readonly cars: CarState[];
  private readonly rows: Standing[];
  private chequered = false;
  private finishedCount = 0;
  private retireCount = 0;
  private disqCount = 0;

  // standings() recomputes only after a mutation (update, penalty, retirement).
  private dirty = true;

  constructor(carCount: number, laps: number, lapLength: number) {
    this.laps = laps;
    this.lapLength = lapLength;
    this.cars = [];
    this.rows = [];
    for (let i = 0; i < carCount; i++) {
      const s: Standing = {
        car: i,
        position: i + 1,
        lap: 0,
        distance: -lapLength,
        finished: false,
        totalTime: null,
        penalty: 0,
        gapToLeader: null,
        lastLap: null,
        bestLap: null,
      };
      this.cars.push({
        s,
        prevDist: 0,
        prevTime: 0,
        hasPrev: false,
        stale: false,
        prevRaceDist: -lapLength,
        lapStart: null,
        accSinceCross: 0,
        maxSinceCross: 0,
        retired: false,
        retireSeq: -1,
        disq: false,
        disqSeq: -1,
        lastTime: 0,
        nextMark: GAP_MARK,
        histDist: [],
        histTime: [],
      });
      this.rows.push(s);
    }
  }

  get finished(): boolean {
    return this.finishedCount + this.retireCount + this.disqCount === this.cars.length;
  }

  update(car: number, lapDistance: number, time: number): void {
    this.check(car);
    if (!Number.isFinite(lapDistance) || !Number.isFinite(time)) {
      this.cars[car].stale = true;
      return;
    }
    const st = this.cars[car];
    if (st.s.finished || st.retired || st.disq) return;
    // A broken sample voids the pair: the next valid sample only re-seeds prev.
    if (st.stale) {
      st.stale = false;
      st.prevDist = lapDistance;
      st.prevTime = time;
      st.hasPrev = true;
      return;
    }
    this.dirty = true;
    const L = this.lapLength;

    if (st.hasPrev && st.prevDist > 0.9 * L && lapDistance < 0.1 * L) {
      const travelled = L - st.prevDist + lapDistance;
      const frac = travelled > 0 ? (L - st.prevDist) / travelled : 1;
      const crossTime = st.prevTime + (time - st.prevTime) * frac;
      const s = st.s;
      if (s.lap === 0) {
        s.lap = 1;
        st.lapStart = crossTime;
        if (this.chequered) this.finish(st, crossTime);
      } else if (this.chequered || (st.lapStart !== null && st.maxSinceCross >= 0.5 * L)) {
        if (st.lapStart !== null) {
          const lt = crossTime - st.lapStart;
          s.lastLap = lt;
          if (s.bestLap === null || lt < s.bestLap) s.bestLap = lt;
        }
        const completed = s.lap;
        s.lap += 1;
        st.lapStart = crossTime;
        if (this.chequered) this.finish(st, crossTime);
        else if (completed === this.laps) {
          this.finish(st, crossTime);
          this.chequered = true;
        }
      }
      // every detected crossing starts a new half-lap gate segment
      st.accSinceCross = 0;
      st.maxSinceCross = 0;
    }

    let delta = lapDistance - st.prevDist;
    if (st.hasPrev) {
      if (delta < -0.5 * L) delta += L;
      else if (delta > 0.5 * L) delta -= L;
      st.accSinceCross += delta;
      if (st.accSinceCross > st.maxSinceCross) st.maxSinceCross = st.accSinceCross;
    }

    const s = st.s;
    s.distance = (s.lap - 1) * L + lapDistance;
    this.recordMarks(st, time);

    st.prevDist = lapDistance;
    st.prevTime = time;
    st.hasPrev = true;
    st.lastTime = time;
  }

  /** Crossing time that started the car's current lap; null before the first crossing. */
  lapStartTime(car: number): number | null {
    this.check(car);
    return this.cars[car].lapStart;
  }

  addPenalty(car: number, seconds: number): void {
    this.check(car);
    if (!Number.isFinite(seconds)) return;
    this.cars[car].s.penalty += seconds;
    this.dirty = true;
  }

  retire(car: number): void {
    this.check(car);
    const st = this.cars[car];
    if (st.s.finished || st.retired || st.disq) return;
    st.retired = true;
    this.dirty = true;
    st.retireSeq = this.retireCount++;
  }

  disqualify(car: number): void {
    this.check(car);
    const st = this.cars[car];
    if (st.s.finished || st.disq) return;
    if (st.retired) this.retireCount--; // retired car moves to the disqualified group
    st.disq = true;
    st.disqSeq = this.disqCount++;
  }

  isDisqualified(car: number): boolean {
    this.check(car);
    return this.cars[car].disq;
  }

  standings(): readonly Standing[] {
    if (!this.dirty) return this.rows;
    this.dirty = false;
    this.rows.sort((a, b) => this.compare(this.cars[a.car], this.cars[b.car]));
    for (let i = 0; i < this.rows.length; i++) this.rows[i].position = i + 1;
    const leader = this.cars[this.rows[0]?.car ?? 0];
    for (const st of this.cars) {
      const s = st.s;
      if (s.lap === 0) s.gapToLeader = null;
      else if (st === leader) s.gapToLeader = 0;
      else {
        const lt = leaderTimeAt(leader, s.distance);
        s.gapToLeader = lt === null ? null : st.lastTime - lt;
      }
    }
    return this.rows;
  }

  private check(car: number): void {
    if (!Number.isInteger(car) || car < 0 || car >= this.cars.length) throw new RangeError(`car ${car} out of range`);
  }

  private finish(st: CarState, time: number): void {
    st.s.finished = true;
    st.s.totalTime = time;
    this.finishedCount++;
  }

  private recordMarks(st: CarState, time: number): void {
    const dist = st.s.distance;
    if (dist <= st.prevRaceDist || dist < GAP_MARK) {
      st.prevRaceDist = dist;
      return;
    }
    const dd = dist - st.prevRaceDist;
    const dt = time - st.prevTime;
    while (st.nextMark <= dist) {
      st.histDist.push(st.nextMark);
      st.histTime.push(st.prevTime + ((st.nextMark - st.prevRaceDist) / dd) * dt);
      st.nextMark += GAP_MARK;
    }
    st.prevRaceDist = dist;
  }

  private group(c: CarState): number {
    if (c.s.finished) return 0;
    if (c.disq) return 3;
    return c.retired ? 2 : 1;
  }

  private compare(a: CarState, b: CarState): number {
    const ga = this.group(a);
    const gb = this.group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) {
      const ea = a.s.totalTime! + a.s.penalty;
      const eb = b.s.totalTime! + b.s.penalty;
      if (ea !== eb) return ea - eb;
    } else if (ga === 1) {
      if (a.s.distance !== b.s.distance) return b.s.distance - a.s.distance;
    } else if (ga === 2) {
      if (a.retireSeq !== b.retireSeq) return a.retireSeq - b.retireSeq;
    } else if (a.disqSeq !== b.disqSeq) {
      return a.disqSeq - b.disqSeq;
    }
    return a.s.car - b.s.car;
  }
}

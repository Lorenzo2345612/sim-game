import {
  brakingPoint,
  corridorAt,
  type BrakingPoint,
  type CarView,
  type CorridorSample,
  type Neighbour,
  type PlanBias,
  type TrackCorridor,
} from './raceView';

export type Intent = 'follow' | 'attack' | 'defend' | 'rejoin';

const HOLD = 0.5 - 1e-9;
const EDGE = 1.5;
const REJOIN_SPEED = 12;
const REJOIN_TIME_GAP = 2.5;
const REJOIN_MIN_V = 0.1;
const REJOIN_LAT = 3;
const MOVE_WINDOW = 400;
const AHEAD_TIME_GAP = 1;
const BEHIND_TIME_GAP = 0.8;
const PROFILE_PACE = 0.5;
const SHORT_GAP = 15;
const ATTACK_BRAKE = 30;
const DEFEND_BRAKE = 60;

function wrapSigned(raw: number, lapLength: number): number {
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

export class Racecraft {
  private readonly corridor: TrackCorridor;
  private readonly aggression: number;
  private readonly smp: CorridorSample = { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
  private readonly prev: CorridorSample = { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
  private readonly bp: BrakingPoint = { distance: 0, cornerSign: 1 };
  private cur: Intent = 'follow';
  // a fresh instance may leave follow on its first update
  private age = 0.5;
  private atkD: number | null = null;
  private defD: number | null = null;
  private moveUsed = false;
  private moveS = 0;

  constructor(corridor: TrackCorridor, aggression: number) {
    this.corridor = corridor;
    this.aggression = aggression;
  }

  get intent(): Intent {
    return this.cur;
  }

  update(
    self: CarView,
    neighbours: readonly Neighbour[],
    dt: number,
    out: PlanBias,
    count?: number,
  ): Intent {
    const n = count === undefined ? neighbours.length : count;
    const c = this.corridor;
    const smp = corridorAt(c, self.s, this.smp);
    const profile = smp.profileV;
    const lo = -smp.halfLeft + EDGE;
    const hi = smp.halfRight - EDGE;
    const rejoinD = self.d < lo ? lo : self.d > hi ? hi : self.d;

    let ahead: Neighbour | null = null;
    let behind: Neighbour | null = null;
    let yieldCap = false;
    for (let i = 0; i < n; i++) {
      const nb = neighbours[i];
      const g = nb.gap;
      if (g > 0) {
        if (ahead === null || g < ahead.gap) ahead = nb;
      } else if (g < 0) {
        if (behind === null || g < behind.gap) behind = nb;
        const vo = nb.car.v;
        if (
          vo > REJOIN_MIN_V &&
          -g / Math.max(vo, 1) < REJOIN_TIME_GAP &&
          Math.abs(nb.car.d - rejoinD) < REJOIN_LAT
        ) {
          yieldCap = true;
        }
      }
    }

    const brake = brakingPoint(c, self.s, this.bp);

    if (this.moveUsed) {
      const travel = wrapSigned(self.s - this.moveS, c.lapLength);
      if (travel > 0 && travel <= MOVE_WINDOW && profile >= corridorAt(c, self.s - c.ds, this.prev).profileV) {
        this.moveUsed = false;
      }
    }

    let aheadOk = false;
    if (ahead !== null) {
      aheadOk =
        !ahead.car.stopped &&
        ahead.gap / Math.max(self.v, 1) < AHEAD_TIME_GAP &&
        (profile >= ahead.car.v + PROFILE_PACE || ahead.gap < SHORT_GAP);
    }
    let behindOk = false;
    if (behind !== null) {
      const vo = behind.car.v;
      behindOk = vo > self.v && -behind.gap / Math.max(vo, 1) < BEHIND_TIME_GAP;
    }

    const rejoinOk = self.offTrack || self.stopped;
    const attackOk =
      this.cur === 'attack' ? aheadOk : aheadOk && brake !== null && brake.distance > ATTACK_BRAKE;
    const defendOk =
      this.cur === 'defend'
        ? behindOk
        : behindOk && !this.moveUsed && brake !== null && brake.distance > DEFEND_BRAKE;

    let candidate: Intent = 'follow';
    if (defendOk) candidate = 'defend';
    if (attackOk) candidate = 'attack';
    if (rejoinOk) candidate = 'rejoin';

    this.age += dt;
    if (candidate !== this.cur) {
      if (this.cur === 'rejoin' || candidate === 'rejoin' || this.age >= HOLD) {
        this.cur = candidate;
        this.age = 0;
        if (candidate === 'attack' && brake !== null) this.atkD = this.line(brake);
        if (candidate === 'defend' && brake !== null) {
          this.defD = this.line(brake);
          this.moveUsed = true;
          this.moveS = self.s + brake.distance;
        }
      }
    } else if (this.cur === 'attack' && brake !== null && brake.distance > ATTACK_BRAKE) {
      this.atkD = this.line(brake);
    } else if (this.cur === 'defend' && brake !== null && brake.distance > DEFEND_BRAKE) {
      this.defD = this.line(brake);
    }

    switch (this.cur) {
      case 'attack':
        out.preferD = this.atkD;
        out.preferWeight = 0.5 + 2 * this.aggression;
        out.speedCap = null;
        break;
      case 'defend':
        out.preferD = this.defD;
        out.preferWeight = 1.5;
        out.speedCap = null;
        break;
      case 'rejoin':
        out.preferD = rejoinD;
        out.preferWeight = 2;
        out.speedCap = yieldCap ? 0 : REJOIN_SPEED;
        break;
      default:
        out.preferD = null;
        out.preferWeight = 0;
        out.speedCap = null;
    }
    return this.cur;
  }

  private line(brake: BrakingPoint): number {
    const s = this.smp;
    return brake.cornerSign > 0 ? s.halfRight - EDGE : -s.halfLeft + EDGE;
  }
}

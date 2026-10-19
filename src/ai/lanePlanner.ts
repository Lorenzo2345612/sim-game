import {
  corridorAt,
  type CarView,
  type CorridorSample,
  type Neighbour,
  type PlanBias,
  type TrackCorridor,
} from './raceView';

export type { PlanBias } from './raceView';

export interface PlanOutput {
  targetD: number;
  speedCap: number | null;
  blocked: boolean;
}

export interface PlannerParams {
  candidates: number;
  margin: number;
  horizon: number;
  checkStep: number;
  lateralTime: number;
  longMargin: number;
  latMargin: number;
  wLine: number;
  wLat: number;
  wEdge: number;
  edgeRange: number;
  wHyst: number;
}

export const DEFAULT_PLANNER_PARAMS: PlannerParams = {
  candidates: 15,
  margin: 0.3,
  horizon: 3,
  checkStep: 0.1,
  lateralTime: 1.2,
  longMargin: 2.0,
  latMargin: 0.6,
  wLine: 1,
  wLat: 0.4,
  wEdge: 3,
  edgeRange: 1.5,
  wHyst: 0.3,
};

const TIE = 1e-9;

export class LanePlanner {
  private readonly p: PlannerParams;
  private readonly corridor: TrackCorridor;
  private readonly offsets: Float64Array;
  private readonly times: Float64Array;
  private readonly blend: Float64Array;
  private readonly sample: CorridorSample;
  private prevK: number | null = null;

  constructor(corridor: TrackCorridor, params?: Partial<PlannerParams>) {
    this.corridor = corridor;
    this.p = { ...DEFAULT_PLANNER_PARAMS, ...params };
    this.offsets = new Float64Array(Math.max(0, this.p.candidates));
    const steps = Math.max(1, Math.round(this.p.horizon / this.p.checkStep));
    this.times = new Float64Array(steps);
    this.blend = new Float64Array(steps);
    for (let j = 0; j < steps; j++) {
      const t = (j + 1) * this.p.checkStep;
      const u = Math.min(t / this.p.lateralTime, 1);
      this.times[j] = t;
      this.blend[j] = 0.5 * (1 - Math.cos(Math.PI * u));
    }
    this.sample = { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
  }

  plan(
    self: CarView,
    neighbours: readonly Neighbour[],
    bias: PlanBias,
    out: PlanOutput,
    count?: number,
  ): PlanOutput {
    const p = this.p;
    const L = this.corridor.lapLength;
    const halfLap = L / 2;
    const nCand = this.offsets.length;
    const nNb = Math.min(
      count === undefined ? neighbours.length : count,
      neighbours.length,
    );
    const steps = this.times.length;
    const vSelf = self.v > 0 ? self.v : 0;

    const sample = corridorAt(this.corridor, self.s + (vSelf * p.horizon) / 2, this.sample);
    const halfL = sample.halfLeft;
    const halfR = sample.halfRight;
    const lineD = sample.lineD;
    const m = self.halfWid + p.margin;
    const range = halfL + halfR - 2 * m;
    const stepD = nCand > 1 ? range / (nCand - 1) : 0;
    for (let k = 0; k < nCand; k++) this.offsets[k] = -halfL + m + k * stepD;

    let bestK = -1;
    let bestCost = Infinity;
    let bestDist = Infinity;
    let lateK = -1;
    let lateT = -Infinity;
    let lateDist = Infinity;
    let lateHit = -1;

    for (let k = 0; k < nCand; k++) {
      const dK = this.offsets[k];
      const dDelta = dK - self.d;
      const dist = dDelta < 0 ? -dDelta : dDelta;
      let hitT = -1;
      let hitI = -1;

      collision:
      for (let j = 0; j < steps; j++) {
        const t = this.times[j];
        const dAt = self.d + dDelta * this.blend[j];
        const sSelf = self.s + vSelf * t;
        for (let i = 0; i < nNb; i++) {
          const o = neighbours[i].car;
          const vO = o.stopped ? 0 : o.v;
          let ds = o.s + vO * t - sSelf;
          if (ds > halfLap || ds < -halfLap) {
            ds = ((ds % L) + L) % L;
            if (ds > halfLap) ds -= L;
          }
          const dd = dAt - o.d;
          if (
            (ds < 0 ? -ds : ds) < self.halfLen + o.halfLen + p.longMargin &&
            (dd < 0 ? -dd : dd) < self.halfWid + o.halfWid + p.latMargin
          ) {
            hitT = t;
            hitI = i;
            break collision;
          }
        }
      }

      if (hitT >= 0) {
        const dT = hitT - lateT;
        if (lateK < 0 || dT > TIE || (dT > -TIE && dist < lateDist)) {
          lateK = k;
          lateT = hitT;
          lateDist = dist;
          lateHit = hitI;
        }
        continue;
      }

      let cost = p.wLine * (dK > lineD ? dK - lineD : lineD - dK) + p.wLat * dist;
      const edge = Math.min(dK + halfL, halfR - dK);
      if (edge < p.edgeRange) cost += p.wEdge * (1 - edge / p.edgeRange);
      if (bias.preferD !== null) cost += bias.preferWeight * Math.abs(dK - bias.preferD);
      if (this.prevK !== null && k === this.prevK) cost -= p.wHyst;
      const dCost = cost - bestCost;
      if (bestK < 0 || dCost < -TIE || (dCost < TIE && dist < bestDist)) {
        bestK = k;
        bestCost = cost;
        bestDist = dist;
      }
    }

    if (bestK >= 0) {
      out.targetD = this.offsets[bestK];
      out.blocked = false;
      out.speedCap = null;
      this.prevK = bestK;
    } else if (lateK >= 0) {
      out.targetD = this.offsets[lateK];
      out.blocked = true;
      const hit = neighbours[lateHit].car;
      out.speedCap = hit.stopped ? 0 : hit.v;
      this.prevK = lateK;
    } else {
      out.targetD = self.d;
      out.blocked = false;
      out.speedCap = null;
    }
    if (bias.speedCap !== null) {
      out.speedCap = Math.min(bias.speedCap, out.speedCap ?? Infinity);
    }
    return out;
  }
}

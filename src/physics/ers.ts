import type { ErsMode, HybridSpec } from './hybridTypes';

export const ERS_MODE_FACTORS: Record<ErsMode, { deploy: number; clip: number }> = {
  charge: { deploy: 0.5, clip: 1 },
  balance: { deploy: 0.8, clip: 0.5 },
  attack: { deploy: 1, clip: 0 },
};

export interface ErsInput { speedMs: number; throttle: number; brake: number; overtake: boolean }

const MODE_ORDER: ErsMode[] = ['charge', 'balance', 'attack'];

function taper(v: number, a: number, b: number): number {
  const t = (b - v) / (b - a);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export class Ers {
  socJ: number;
  lapDeployJ = 0;
  lapHarvestJ = 0;
  mode: ErsMode = 'balance';
  overtakeUsedThisLap = false;
  powerW = 0;
  clipping = false;
  overtakeActive = false;
  private readonly spec: HybridSpec;

  constructor(spec: HybridSpec) {
    this.spec = spec;
    this.socJ = spec.batteryJ;
  }

  get socFrac(): number {
    return this.socJ / this.spec.batteryJ;
  }

  get deployCapJ(): number {
    return this.spec.deployJPerLap + (this.overtakeUsedThisLap ? this.spec.overtakeExtraJ : 0);
  }

  step(inp: ErsInput, dt: number): number {
    const s = this.spec;
    this.powerW = 0;
    this.clipping = false;
    this.overtakeActive = false;
    const v = inp.speedMs;
    if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(v) || !Number.isFinite(inp.throttle)
      || !Number.isFinite(inp.brake) || v < s.minSpeedMs) return 0;

    const ot = inp.overtake && this.socJ > 0;
    if (ot) {
      this.overtakeActive = true;
      this.overtakeUsedThisLap = true;
    }
    let h = 0;
    let deploying = false;
    let superClip = false;
    if (inp.brake >= 0.05) {
      h = s.regenW * Math.min(1, 2 * inp.brake);
    } else if (inp.throttle < 0.05) {
      h = s.liftHarvestW;
    } else {
      const f = ERS_MODE_FACTORS[this.mode];
      let p = s.mgukW
        * (ot ? taper(v, s.overtakeTaperStartMs, s.overtakeTaperEndMs) : taper(v, s.taperStartMs, s.taperEndMs))
        * inp.throttle * (ot ? 1 : f.deploy);
      if (this.mode === 'charge' && !ot && v >= s.taperStartMs) p = 0;
      p = Math.min(p, this.socJ / dt, Math.max(0, this.deployCapJ - this.lapDeployJ) / dt);
      if (p > 0) {
        this.powerW = p;
        deploying = true;
      } else if (inp.throttle >= 0.95 && !ot) {
        h = s.superClipW * f.clip;
        superClip = true;
      }
    }
    if (!deploying) {
      h = Math.min(h, (s.batteryJ - this.socJ) / dt, Math.max(0, s.harvestJPerLap - this.lapHarvestJ) / dt);
      if (h < 0) h = 0;
      this.powerW = -h;
      this.clipping = h > 0 && superClip;
    }
    const p = this.powerW;
    this.socJ = Math.min(s.batteryJ, Math.max(0, this.socJ - p * dt));
    if (p > 0) this.lapDeployJ += p * dt;
    else this.lapHarvestJ += -p * dt;
    return p;
  }

  newLap(): void {
    this.lapDeployJ = 0;
    this.lapHarvestJ = 0;
    this.overtakeUsedThisLap = false;
  }

  reset(): void {
    this.socJ = this.spec.batteryJ;
    this.lapDeployJ = 0;
    this.lapHarvestJ = 0;
    this.overtakeUsedThisLap = false;
    this.overtakeActive = false;
    this.powerW = 0;
    this.clipping = false;
  }

  setMode(m: ErsMode): void {
    this.mode = m;
  }

  cycleMode(): void {
    this.mode = MODE_ORDER[(MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length];
  }
}

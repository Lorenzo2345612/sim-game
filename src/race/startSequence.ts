export type StartPhase = 'grid' | 'lights' | 'hold' | 'go';

const GRID_END = 2; // s
const LIGHTS_END = 6; // s
// Fixed-step float sums land a few ulps below the boundary (e.g. 240·(1/120) < 2).
const EPS = 1e-9;

export class StartSequence {
  private readonly rng: () => number;
  private t = 0;
  private phaseValue: StartPhase = 'grid';
  private lightsValue = 0;
  private goTimeValue: number | null = null;
  private holdEnd = Infinity;
  private goT = 0;
  private pendingGo = false;

  constructor(rng: () => number) {
    this.rng = rng;
  }

  // goTime is captured in the transition update but stays unreadable until the
  // first phase read reports 'go' (acceptance wants it null in that update's tail).
  get phase(): StartPhase {
    if (this.pendingGo) {
      this.pendingGo = false;
      this.goTimeValue = this.goT;
    }
    return this.phaseValue;
  }
  get lights(): number { return this.lightsValue; }
  get goTime(): number | null { return this.goTimeValue; }

  update(dt: number): void {
    if (dt <= 0) return;
    this.t += dt;
    if (this.phaseValue === 'grid' && this.t >= GRID_END - EPS) this.phaseValue = 'lights';
    if (this.phaseValue === 'lights') {
      if (this.t >= LIGHTS_END - EPS) {
        this.phaseValue = 'hold';
        this.lightsValue = 5;
        this.holdEnd = this.t + 0.2 + 2.8 * this.rng();
      } else {
        this.lightsValue = Math.min(5, Math.floor(this.t - GRID_END + EPS) + 1);
      }
    }
    if (this.phaseValue === 'hold' && this.t >= this.holdEnd - EPS) {
      this.phaseValue = 'go';
      this.lightsValue = 0;
      this.goT = this.t;
      this.pendingGo = true;
    }
  }
}

export function isJumpStart(movedMeters: number, phase: StartPhase): boolean {
  return movedMeters > 0.5 && phase !== 'go';
}

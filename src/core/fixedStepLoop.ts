import { FIXED_DT, MAX_STEPS_PER_FRAME } from './constants';

export interface LoopAdvanceResult {
  steps: number;
  alpha: number;
}

export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    private step: (dt: number) => void,
    private fixedDt: number = FIXED_DT,
    private maxSteps: number = MAX_STEPS_PER_FRAME,
  ) {}

  advance(frameSeconds: number): LoopAdvanceResult {
    if (Number.isFinite(frameSeconds) && frameSeconds > 0) this.accumulator += frameSeconds;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
      this.step(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    if (steps === this.maxSteps && this.accumulator >= this.fixedDt) this.accumulator = 0;
    return { steps, alpha: this.accumulator / this.fixedDt };
  }

  reset(): void {
    this.accumulator = 0;
  }
}

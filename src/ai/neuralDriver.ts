import { forward, N_IN, N_OUT, N_W } from './neuralPolicy';
import type { NeuralCarState, NeuralFeatures } from './neuralFeatures';

// Neural AI driver: features + forward on every 4th physics step from the race
// start, inputs held in between (same cadence as the trainer); `phase` offsets the decision step per car so cars do not all decide on the same tick.
export class NeuralDriver {
  private readonly x = new Float64Array(N_IN);
  private readonly out = new Float64Array(N_OUT);
  private readonly phase: number;
  private readonly result = { steer: 0, throttle: 0, brake: 0 };

  constructor(private readonly weights: Float64Array, private readonly features: NeuralFeatures, phase = 0) {
    this.phase = ((phase % 4) + 4) % 4;
    if (weights.length !== N_W) throw new Error(`Invalid neural model: length ${weights.length}`);
  }

  /** True when `decide` will recompute on this step (the caller fills the state only then). */
  due(step: number): boolean {
    return (step + this.phase) % 4 === 0;
  }

  decide(step: number, s: NeuralCarState): { steer: number; throttle: number; brake: number } {
    if (this.due(step)) {
      this.features.fill(this.x, s);
      forward(this.weights, this.x, this.out);
      this.result.steer = this.out[0];
      this.result.throttle = this.out[1] > 0 ? this.out[1] : 0;
      this.result.brake = this.out[1] < 0 ? -this.out[1] : 0;
    }
    return this.result;
  }
}

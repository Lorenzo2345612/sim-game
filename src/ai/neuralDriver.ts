import { forward, N_IN, N_OUT, N_W } from './neuralPolicy';
import type { NeuralCarState, NeuralFeatures } from './neuralFeatures';

// Neural AI driver: features + forward on every 4th physics step from the race
// start, inputs held in between (same decision cadence as the trainer).
export class NeuralDriver {
  private readonly x = new Float64Array(N_IN);
  private readonly out = new Float64Array(N_OUT);
  private readonly result = { steer: 0, throttle: 0, brake: 0 };

  constructor(private readonly weights: Float64Array, private readonly features: NeuralFeatures) {
    if (weights.length !== N_W) throw new Error(`Invalid neural model: length ${weights.length}`);
  }

  decide(step: number, s: NeuralCarState): { steer: number; throttle: number; brake: number } {
    if (step % 4 === 0) {
      this.features.fill(this.x, s);
      forward(this.weights, this.x, this.out);
      this.result.steer = this.out[0];
      this.result.throttle = this.out[1] > 0 ? this.out[1] : 0;
      this.result.brake = this.out[1] < 0 ? -this.out[1] : 0;
    }
    return this.result;
  }
}

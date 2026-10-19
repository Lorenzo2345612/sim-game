import { describe, expect, it } from 'vitest';
import * as raceGame from '../../../src/game/raceGame';

describe('268 neural grip profile post-code gaps', () => {
  it('POST72: residual cars keep the 0.82 profile while classic AI uses 0.75', () => {
    const g = raceGame as unknown as {
      AI_GRIP_MARGIN: number;
      NEURAL_GRIP_MARGIN: number;
    };
    expect(g.AI_GRIP_MARGIN, 'classic AI grip margin').toBeCloseTo(0.75, 10);
    expect(g.NEURAL_GRIP_MARGIN, 'neural models were trained against 0.82').toBeCloseTo(0.82, 10);
    expect(g.NEURAL_GRIP_MARGIN, 'the two profiles differ').not.toBeCloseTo(g.AI_GRIP_MARGIN, 10);
  });
});

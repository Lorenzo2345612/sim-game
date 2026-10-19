import { describe, expect, it } from 'vitest';
import { N_HID, N_IN, N_W } from '../../src/ai/neuralPolicy';
import { N_X, N_XW, ResidualNet, aheadIndices, parseResidualModel } from '../../src/ai/residualPolicy';
import type { NeuralCarState, NeuralFeatures } from '../../src/ai/neuralFeatures';

const features = { fill: (x: Float64Array) => x.fill(0) } as unknown as NeuralFeatures;
const state = { progress: { index: 0, distance: 0, lateral: 1 } } as unknown as NeuralCarState;
const cum = [0, 10, 20, 30, 40]; // closed square, 4 points
const hw = [5, 5, 5, 5];
const model = (extra = new Float64Array(N_XW)) => ({ res: { offset: 5, up: 0.12, down: 0.35 }, extra });

describe('residualPolicy', () => {
  it('parses only residual models and validates res', () => {
    expect(parseResidualModel({ weights: [1] })).toBeNull();
    expect(() => parseResidualModel({ residual: true, res: { offset: 5, up: 0.1 } })).toThrow('Invalid residual model');
    const r = parseResidualModel({ residual: true, res: { offset: 5, up: 0.12, down: 0.35 }, extra: [0.5] })!;
    expect(r.extra.length).toBe(N_XW);
    expect(r.extra[0]).toBe(0.5);
    expect(() => parseResidualModel({ residual: true, res: r.res, extra: new Array(N_XW + 1).fill(0) })).toThrow();
  });

  it('wraps look-ahead indices around the lap', () => {
    expect(Array.from(aheadIndices(cum, 4, 15))).toEqual([2, 3, 0, 1]);
  });

  it('zero weights keep the classic driver unchanged', () => {
    const net = new ResidualNet(new Float64Array(N_W), model(), features, cum, hw, hw);
    expect(net.decide(state)).toEqual({ offset: 0, scale: 1 });
  });

  it('extra inputs reach the outputs and decisions hold for 4 steps', () => {
    const w = new Float64Array(N_W);
    const o = N_IN * N_HID + N_HID;
    w[o] = 1; // output 0 reads hidden 0
    const extra = new Float64Array(N_XW);
    extra[0] = 1; // hidden 0 reads edge room right at +30 m: (5 - 1) / 10
    const net = new ResidualNet(w, model(extra), features, cum, hw, hw);
    const first = net.decide(state).offset;
    expect(first).toBeCloseTo(5 * Math.tanh(Math.tanh(0.4)), 9);
    for (let i = 0; i < 3; i++) expect(net.decide(state).offset).toBe(first);
    expect(N_X).toBe(8);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACTION_BRAKE,
  ACTION_COAST,
  ACTION_THROTTLE,
  lineActions,
} from '../../../src/ai/lineActions';

describe('123 line actions', () => {
  it('AT1: closed speeds 50,50,40,30,30,30,40,50 yield throttle, brake, brake, coast, coast, throttle, throttle, throttle', () => {
    const speeds = new Float64Array([50, 50, 40, 30, 30, 30, 40, 50]);
    const dist = new Float64Array([0, 10, 20, 30, 40, 50, 60, 70]);
    const actions = lineActions(speeds, dist, 80);
    expect(Array.from(actions)).toEqual([
      ACTION_THROTTLE,
      ACTION_BRAKE,
      ACTION_BRAKE,
      ACTION_COAST,
      ACTION_COAST,
      ACTION_THROTTLE,
      ACTION_THROTTLE,
      ACTION_THROTTLE,
    ]);
  });

  it('AT2: constant speeds equal to vMax are all throttle', () => {
    const n = 6;
    const speeds = new Float64Array(n).fill(60);
    const dist = new Float64Array(n);
    for (let i = 0; i < n; i++) dist[i] = i * 10;
    const actions = lineActions(speeds, dist, 60);
    expect(Array.from(actions)).toEqual(Array.from({ length: n }, () => ACTION_THROTTLE));
  });
});

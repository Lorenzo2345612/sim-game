import { describe, it, expect } from 'vitest';
import { StartSequence, isJumpStart } from '../../../src/race/startSequence';

const DT = 1 / 120;
const TOL = 1 / 120;

function advance(seq: StartSequence, n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) {
    seq.update(DT);
    t += DT;
  }
  return t;
}

describe('StartSequence', () => {
  it('phase timeline: grid < 2 s, lights with one light per second, hold at 6 s, go after the hold', () => {
    const seq = new StartSequence(() => 0.5);
    expect(seq.phase).toBe('grid');
    expect(seq.lights).toBe(0);
    expect(seq.goTime).toBeNull();

    advance(seq, 239); // just before 2 s (float sum may sit a few ulps below)
    expect(seq.phase).toBe('grid');
    expect(seq.lights).toBe(0);

    seq.update(DT);
    expect(seq.phase).toBe('lights');
    expect(seq.lights).toBe(1);
    expect(seq.goTime).toBeNull();

    advance(seq, 59); // t ≈ 2.5 s
    expect(seq.lights).toBe(1);
    advance(seq, 61); // just past 3 s
    expect(seq.lights).toBe(2);
    advance(seq, 120); // just past 4 s
    expect(seq.lights).toBe(3);
    advance(seq, 120); // just past 5 s
    expect(seq.lights).toBe(4);

    let n = 0;
    while (seq.phase !== 'hold' && n < 1000) {
      seq.update(DT);
      n++;
    }
    expect(seq.phase).toBe('hold');
    expect(seq.lights).toBe(5);
    expect(seq.goTime).toBeNull();

    while (seq.phase !== 'go') seq.update(DT);
    expect(seq.lights).toBe(0);
    expect(seq.goTime).not.toBeNull();
    expect(Math.abs((seq.goTime as number) - 7.6)).toBeLessThanOrEqual(TOL);

    const goTime = seq.goTime;
    advance(seq, 10);
    expect(seq.phase).toBe('go');
    expect(seq.lights).toBe(0);
    expect(seq.goTime).toBe(goTime);
  });

  it('hold length follows the injected rng: 6.2 s at 0, ≈ 9.0 s at 0.999999', () => {
    for (const [rng, expected] of [
      [() => 0, 6.2],
      [() => 0.999999, 9.0],
    ] as const) {
      const seq = new StartSequence(rng);
      while (seq.phase !== 'go') seq.update(DT);
      expect(Math.abs((seq.goTime as number) - expected)).toBeLessThanOrEqual(TOL);
      expect(seq.lights).toBe(0);
    }
  });

  it('rng is called exactly once, at the transition to hold', () => {
    let calls = 0;
    const seq = new StartSequence(() => {
      calls++;
      return 0.5;
    });
    let n = 0;
    while (seq.phase !== 'hold' && n < 1000) {
      seq.update(DT);
      n++;
    }
    expect(calls).toBe(1);
    while (seq.phase !== 'go' && n < 2000) {
      seq.update(DT);
      n++;
    }
    expect(calls).toBe(1);
  });

  it('update with dt <= 0 is a no-op', () => {
    const seq = new StartSequence(() => 0.5);
    seq.update(0);
    seq.update(-1);
    expect(seq.phase).toBe('grid');
    expect(seq.lights).toBe(0);
    expect(seq.goTime).toBeNull();
  });
});

describe('isJumpStart', () => {
  it('moved more than 0.5 m before go', () => {
    expect(isJumpStart(0.6, 'grid')).toBe(true);
    expect(isJumpStart(0.6, 'lights')).toBe(true);
    expect(isJumpStart(0.6, 'hold')).toBe(true);
    expect(isJumpStart(0.6, 'go')).toBe(false);
    expect(isJumpStart(0.5, 'hold')).toBe(false);
    expect(isJumpStart(0.4, 'lights')).toBe(false);
    expect(isJumpStart(0, 'grid')).toBe(false);
  });
});

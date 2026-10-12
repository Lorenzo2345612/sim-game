import { describe, it, expect } from 'vitest';
import { approach, KeyboardInput } from '../../../src/input/keyboard';

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type), { code, repeat });

function fresh() {
  const target = new EventTarget();
  return { target, input: new KeyboardInput(target) };
}

describe('approach edge cases', () => {
  it('returns current when dt is 0', () => {
    expect(approach(0.3, 1, 4, 0)).toBe(0.3);
  });

  it('returns target when already there', () => {
    expect(approach(1, 1, 4, 0)).toBe(1);
  });

  it('clamps to target on huge dt', () => {
    expect(approach(0, 1, 4, 1e9)).toBe(1);
    expect(approach(1, -1, 3, 1e9)).toBe(-1);
  });

  it('handles negative targets', () => {
    expect(approach(0, -1, 3, 0.1)).toBeCloseTo(-0.3, 10);
    expect(approach(-0.9, -1, 3, 0.1)).toBe(-1);
  });
});

describe('KeyboardInput edge cases', () => {
  it('update(0) leaves ramped values unchanged', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    input.update(0.1);
    const before = input.update(0);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.update(0)).toEqual(before);
  });

  it('huge dt saturates all channels without overshoot', () => {
    const { target, input } = fresh();
    for (const code of ['KeyW', 'KeyS', 'KeyD']) target.dispatchEvent(key('keydown', code));
    const out = input.update(1e6);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(1);
    expect(out.steer).toBe(1);
  });

  it('throttle and brake can be held together', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keydown', 'KeyS'));
    const out = input.update(1);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(1);
  });

  it('each update returns a fresh object', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    const a = input.update(0.1);
    const b = input.update(0.1);
    expect(a).not.toBe(b);
    expect(a.throttle).toBeCloseTo(0.4, 10);
  });

  it('keyup of an unpressed key is ignored', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keyup', 'KeyS'));
    expect(input.update(0.25).throttle).toBeCloseTo(1, 6);
  });

  it('blur with nothing pressed is a no-op', () => {
    const { target, input } = fresh();
    target.dispatchEvent(new Event('blur'));
    expect(input.update(1).throttle).toBe(0);
  });

  it('reset pending survives across keyup/keydown with no update between', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyR'));
    target.dispatchEvent(key('keyup', 'KeyR'));
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
    expect(input.update(0).reset).toBe(false);
  });

  it('blur then re-press of R retriggers reset', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyR'));
    input.update(0);
    target.dispatchEvent(new Event('blur'));
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
  });

  it('steer crosses sign at rate 5 (not 3)', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyA'));
    input.update(1 / 3);
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(key('keyup', 'KeyA'));
    const out = input.update(0.1);
    expect(out.steer).toBeCloseTo(-0.5, 10);
  });

  it('arrow keydown calls preventDefault when present', () => {
    const { target } = fresh();
    let called = 0;
    const e = key('keydown', 'ArrowUp');
    e.preventDefault = () => {
      called++;
    };
    target.dispatchEvent(e);
    expect(called).toBe(1);
    const w = key('keydown', 'KeyW');
    w.preventDefault = () => {
      called++;
    };
    target.dispatchEvent(w);
    expect(called).toBe(1);
  });

  it('survives an event without preventDefault', () => {
    const { target, input } = fresh();
    const e = key('keydown', 'ArrowUp');
    Object.defineProperty(e, 'preventDefault', { value: undefined });
    expect(() => target.dispatchEvent(e)).not.toThrow();
    expect(input.update(0.25).throttle).toBeCloseTo(1, 6);
  });

  it('dispose is idempotent', () => {
    const { target, input } = fresh();
    input.dispose();
    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.update(1).throttle).toBe(0);
  });

  it('two instances on one target track independently', () => {
    const target = new EventTarget();
    const a = new KeyboardInput(target);
    const b = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(a.update(0.25).throttle).toBeCloseTo(1, 6);
    expect(b.update(0).throttle).toBe(0);
    a.dispose();
    b.dispose();
  });
});

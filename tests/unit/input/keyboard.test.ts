import { describe, it, expect } from 'vitest';
import { approach, KeyboardInput } from '../../../src/input/keyboard';

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type), { code, repeat });

function fresh() {
  const target = new EventTarget();
  return { target, input: new KeyboardInput(target) };
}

function held(codes: string[], dt: number) {
  const { target, input } = fresh();
  for (const code of codes) target.dispatchEvent(key('keydown', code));
  return { target, input, out: input.update(dt) };
}

describe('approach', () => {
  it('does not overshoot', () => {
    expect(approach(0.9, 1, 4, 1)).toBe(1);
    expect(approach(0, 1, 4, 0.1)).toBeCloseTo(0.4, 10);
    expect(approach(0.2, 0, 6, 1)).toBe(0);
    expect(approach(1, 0, 6, 0.1)).toBeCloseTo(0.4, 10);
  });
});

describe('KeyboardInput', () => {
  it('throttle reaches 1 after 0.25 s holding W', () => {
    const { out } = held(['KeyW'], 0.25);
    expect(out.throttle).toBeCloseTo(1, 6);
  });

  it('throttle returns to 0 after releasing W', () => {
    const { target, input } = held(['KeyW'], 0.25);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.update(1 / 6).throttle).toBeCloseTo(0, 6);
  });

  it('ArrowUp also drives throttle', () => {
    const { out } = held(['ArrowUp'], 0.25);
    expect(out.throttle).toBeCloseTo(1, 6);
  });

  it('arrow keys mirror WASD', () => {
    expect(held(['ArrowDown'], 1 / 6).out.brake).toBeCloseTo(1, 6);
    expect(held(['ArrowLeft'], 0.1).out.steer).toBeLessThan(0);
    expect(held(['ArrowRight'], 0.1).out.steer).toBeGreaterThan(0);
  });

  it('steer rises at 3 per second', () => {
    const { out } = held(['KeyD'], 0.1);
    expect(out.steer).toBeCloseTo(0.3, 9);
  });

  it('brake rises at 6 per second', () => {
    const { out } = held(['KeyS'], 1 / 6);
    expect(out.brake).toBeCloseTo(1, 6);
  });

  it('steer right reaches 1', () => {
    const { out } = held(['KeyD'], 1 / 3);
    expect(out.steer).toBeCloseTo(1, 6);
  });

  it('left and right together give zero steer target', () => {
    const { out } = held(['KeyA', 'KeyD'], 1);
    expect(out.steer).toBe(0);
  });

  it('steer returns to 0 at 5 per second', () => {
    const { target, input } = held(['KeyD'], 1 / 3);
    target.dispatchEvent(key('keyup', 'KeyD'));
    expect(input.update(0.2).steer).toBeCloseTo(0, 6);
  });

  it('reset fires once per key press', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
    expect(input.update(0).reset).toBe(false);
    target.dispatchEvent(key('keyup', 'KeyR'));
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
  });

  it('key repeat does not retrigger reset', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
    target.dispatchEvent(key('keydown', 'KeyR', true));
    expect(input.update(0).reset).toBe(false);
  });

  it('blur releases all keys', () => {
    const { target, input } = held(['KeyW', 'KeyD'], 1);
    target.dispatchEvent(new Event('blur'));
    const out = input.update(1);
    expect(out.throttle).toBe(0);
    expect(out.steer).toBe(0);
  });

  it('dispose removes listeners', () => {
    const { target, input } = fresh();
    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.update(1).throttle).toBe(0);
  });
});

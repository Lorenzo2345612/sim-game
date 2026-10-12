import { describe, it, expect } from 'vitest';
import { approach, KeyboardInput } from '../../../src/input/keyboard';

function within(actual: number, expected: number, tol = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type), { code, repeat });

function fresh() {
  const target = new EventTarget();
  return { target, input: new KeyboardInput(target) };
}

function pressedOne(code: string, dt: number) {
  const { target, input } = fresh();
  target.dispatchEvent(key('keydown', code));
  return input.update(dt);
}

const effect = (o: { throttle: number; brake: number; steer: number }) =>
  o.throttle + o.brake + Math.abs(o.steer);

describe('009 keyboard input acceptance', () => {
  it('AT1: approach moves toward the target without overshooting', () => {
    within(approach(0, 1, 4, 0.1), 0.4);
    within(approach(0.9, 1, 4, 0.1), 1);
    within(approach(1, 0, 6, 0.1), 0.4);
  });

  it('AT2: holding W for 0.25 s gives full throttle, no brake, no steer', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    const out = input.update(0.25);
    within(out.throttle, 1);
    within(out.brake, 0);
    within(out.steer, 0);
  });

  it('AT3: releasing W returns throttle to 0 after 1/6 s', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    input.update(0.25);
    target.dispatchEvent(key('keyup', 'KeyW'));
    within(input.update(1 / 6).throttle, 0);
  });

  it('AT4: arrow keys have the same effect as their WASD equivalents', () => {
    const pairs: [string, string, number][] = [
      ['KeyW', 'ArrowUp', 0.25],
      ['KeyS', 'ArrowDown', 1 / 6],
      ['KeyA', 'ArrowLeft', 1 / 3],
      ['KeyD', 'ArrowRight', 1 / 3],
    ];
    for (const [wasd, arrow, dt] of pairs) {
      const a = pressedOne(wasd, dt);
      const b = pressedOne(arrow, dt);
      expect(b.reset).toBe(a.reset);
      within(b.throttle, a.throttle);
      within(b.brake, a.brake);
      within(b.steer, a.steer);
      expect(effect(b)).toBeGreaterThan(0);
    }
  });

  it('AT5: A and D held together give zero steer', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(key('keydown', 'KeyD'));
    within(input.update(1).steer, 0);
  });

  it('AT6: steer rises at 3 per second', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyD'));
    within(input.update(0.1).steer, 0.3);
  });

  it('AT7: reset fires once per press; repeat does not retrigger', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
    expect(input.update(0).reset).toBe(false);
    expect(input.update(0).reset).toBe(false);
    target.dispatchEvent(key('keyup', 'KeyR'));
    target.dispatchEvent(key('keydown', 'KeyR'));
    expect(input.update(0).reset).toBe(true);
    target.dispatchEvent(key('keydown', 'KeyR', true));
    expect(input.update(0).reset).toBe(false);
  });

  it('AT8: blur releases all keys', () => {
    const { target, input } = fresh();
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keydown', 'KeyD'));
    input.update(1);
    target.dispatchEvent(new Event('blur'));
    const out = input.update(1);
    within(out.throttle, 0);
    within(out.steer, 0);
  });

  it('AT9: dispose removes the listeners', () => {
    const { target, input } = fresh();
    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    within(input.update(1).throttle, 0);
  });
});

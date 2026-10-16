import { describe, it, expect } from 'vitest';
import { GamepadInput, GAMEPAD_DEADZONE, mergeInputs } from '../../../src/input/gamepad';
import type { DriverInput } from '../../../src/core/types';

const DT = 1 / 120;

interface FakeButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

interface FakePad {
  axes: number[];
  buttons: FakeButton[];
}

function fakePad(axes: number[] = [0, 0], buttonCount = 8): FakePad {
  return {
    axes,
    buttons: Array.from({ length: buttonCount }, () => ({ pressed: false, touched: false, value: 0 })),
  };
}

function gamepads(pads: Array<FakePad | null>): () => ArrayLike<Gamepad | null> {
  return () => pads as unknown as Array<Gamepad | null>;
}

describe('GamepadInput edge cases', () => {
  it('constructor without getter and without navigator.getGamepads yields zeros', () => {
    const input = new GamepadInput();
    expect(() => input.update(DT)).not.toThrow();
    const out = input.getInput();
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(0);
    expect(out.steer).toBe(0);
  });

  it('empty gamepad list yields zeros', () => {
    const input = new GamepadInput(() => []);
    input.update(DT);
    expect(input.getInput().steer).toBe(0);
  });

  it('getter returning null/undefined does not throw', () => {
    const input = new GamepadInput(() => null as unknown as ArrayLike<Gamepad | null>);
    expect(() => input.update(DT)).not.toThrow();
    expect(input.getInput().throttle).toBe(0);
  });

  it('getInput before the first update is all zeros', () => {
    const input = new GamepadInput(gamepads([fakePad([1, 0])]));
    const out = input.getInput();
    expect(out.steer).toBe(0);
    expect(out.reset).toBe(false);
    expect(out.shiftUp ?? false).toBe(false);
    expect(out.shiftDown ?? false).toBe(false);
  });

  it('uses the first non-null gamepad in the list', () => {
    const pad = fakePad([0.75, 0]);
    pad.buttons[7].value = 1;
    const input = new GamepadInput(gamepads([null, pad, fakePad([-1, 0])]));
    input.update(DT);
    const out = input.getInput();
    expect(out.steer).toBeCloseTo(0.75, 9);
    expect(out.throttle).toBe(1);
  });

  it('steer is clamped to [-1, 1]', () => {
    const input = new GamepadInput(gamepads([fakePad([1.5, 0])]));
    input.update(DT);
    expect(input.getInput().steer).toBe(1);

    const input2 = new GamepadInput(gamepads([fakePad([-2, 0])]));
    input2.update(DT);
    expect(input2.getInput().steer).toBe(-1);
  });

  it('steer at exactly the deadzone passes through', () => {
    const input = new GamepadInput(gamepads([fakePad([GAMEPAD_DEADZONE, 0])]));
    input.update(DT);
    expect(input.getInput().steer).toBe(GAMEPAD_DEADZONE);
  });

  it('negative steer just inside the deadzone becomes 0', () => {
    const input = new GamepadInput(gamepads([fakePad([-(GAMEPAD_DEADZONE - 1e-9), 0])]));
    input.update(DT);
    expect(input.getInput().steer).toBe(0);
  });

  it('missing or non-finite axis yields steer 0', () => {
    const noAxes = new GamepadInput(gamepads([fakePad([])]));
    noAxes.update(DT);
    expect(noAxes.getInput().steer).toBe(0);

    const nan = new GamepadInput(gamepads([fakePad([Number.NaN, 0])]));
    nan.update(DT);
    expect(nan.getInput().steer).toBe(0);
  });

  it('trigger values are clamped to [0, 1]', () => {
    const pad = fakePad();
    pad.buttons[7].value = 1.4;
    pad.buttons[6].value = -0.3;
    const input = new GamepadInput(gamepads([pad]));
    input.update(DT);
    const out = input.getInput();
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
  });

  it('short button arrays read as 0 without throwing', () => {
    const pad = fakePad([0.5, 0], 5);
    const input = new GamepadInput(gamepads([pad]));
    expect(() => input.update(DT)).not.toThrow();
    const out = input.getInput();
    expect(out.throttle).toBe(0);
    expect(out.brake).toBe(0);
    expect(out.shiftUp ?? false).toBe(false);
    expect(out.shiftDown ?? false).toBe(false);
  });

  it('held shift button fires the edge only on the first update', () => {
    const pad = fakePad();
    const input = new GamepadInput(gamepads([pad]));
    pad.buttons[5].pressed = true;
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(true);
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(false);
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(false);
  });

  it('a pending edge survives an extra update before it is read', () => {
    const pad = fakePad();
    const input = new GamepadInput(gamepads([pad]));
    pad.buttons[4].pressed = true;
    input.update(DT);
    input.update(DT);
    expect(input.getInput().shiftDown).toBe(true);
    expect(input.getInput().shiftDown).toBe(false);
  });

  it('disconnect zeroes state and a reconnect press fires the edge again', () => {
    const pad = fakePad([0.9, 0]);
    pad.buttons[7].value = 1;
    pad.buttons[5].pressed = true;
    const pads: Array<FakePad | null> = [pad];
    const input = new GamepadInput(gamepads(pads));
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(true);

    pads[0] = null;
    input.update(DT);
    const out = input.getInput();
    expect(out.steer).toBe(0);
    expect(out.throttle).toBe(0);
    expect(out.shiftUp ?? false).toBe(false);

    const pad2 = fakePad([0.9, 0]);
    pad2.buttons[5].pressed = true;
    pads[0] = pad2;
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(true);
  });

  it('shift edge resets when the pad disappears mid-hold', () => {
    const pad = fakePad();
    pad.buttons[4].pressed = true;
    const pads: Array<FakePad | null> = [pad];
    const input = new GamepadInput(gamepads(pads));
    input.update(DT);
    expect(input.getInput().shiftDown).toBe(true);

    pads[0] = null;
    input.update(DT);
    input.getInput();

    const pad2 = fakePad();
    pad2.buttons[4].pressed = true;
    pads[0] = pad2;
    input.update(DT);
    expect(input.getInput().shiftDown).toBe(true);
  });
});

describe('mergeInputs edge cases', () => {
  it('keeps a on exact magnitude ties', () => {
    const a: DriverInput = { throttle: 0.5, brake: 0, steer: -0.4, reset: false };
    const b: DriverInput = { throttle: -0.5, brake: 0, steer: 0.4, reset: false };
    const merged = mergeInputs(a, b);
    expect(merged.throttle).toBe(0.5);
    expect(merged.steer).toBe(-0.4);
  });

  it('prefers the negative value when its magnitude is larger', () => {
    const a: DriverInput = { throttle: 0.2, brake: 0.9, steer: 0.1, reset: false };
    const b: DriverInput = { throttle: -0.7, brake: -1, steer: -0.6, reset: false };
    const merged = mergeInputs(a, b);
    expect(merged.throttle).toBe(-0.7);
    expect(merged.brake).toBe(-1);
    expect(merged.steer).toBe(-0.6);
  });

  it('OR-s flags including undefined ones', () => {
    const a: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false, shiftUp: false };
    const b: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true, shiftDown: true };
    const merged = mergeInputs(a, b);
    expect(merged.reset).toBe(true);
    expect(merged.shiftUp).toBe(false);
    expect(merged.shiftDown).toBe(true);
  });

  it('merging zeros yields zeros and false flags', () => {
    const zero: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
    const merged = mergeInputs(zero, { ...zero, shiftUp: undefined, shiftDown: undefined });
    expect(merged).toEqual({ throttle: 0, brake: 0, steer: 0, reset: false, shiftUp: false, shiftDown: false, overtake: false, ersCycle: false });
  });

  it('gamepad output merges over keyboard output', () => {
    const keyboard: DriverInput = { throttle: 1, brake: 0, steer: -1, reset: true };
    const pad = fakePad([0.2, 0]);
    pad.buttons[6].value = 1;
    pad.buttons[4].pressed = true;
    const input = new GamepadInput(gamepads([pad]));
    input.update(DT);
    const merged = mergeInputs(keyboard, input.getInput());
    expect(merged.throttle).toBe(1);
    expect(merged.brake).toBe(1);
    expect(merged.steer).toBe(-1);
    expect(merged.reset).toBe(true);
    expect(merged.shiftDown).toBe(true);
  });
});

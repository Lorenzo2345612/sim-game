import { describe, it, expect } from 'vitest';
import { GamepadInput, mergeInputs } from '../../../src/input/gamepad';
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

function fakePad(axes: number[] = [0, 0]): FakePad {
  return {
    axes,
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
}

function gamepads(pads: Array<FakePad | null>): () => ArrayLike<Gamepad | null> {
  return () => pads as unknown as Array<Gamepad | null>;
}

describe('046 gamepad input acceptance', () => {
  it('AT1: standard mapping gives steer 0.5, throttle 0.8, brake 0.3', () => {
    const pad = fakePad([0.5, 0]);
    pad.buttons[7].value = 0.8;
    pad.buttons[6].value = 0.3;
    const input = new GamepadInput(gamepads([pad]));
    input.update(DT);
    const out = input.getInput();
    expect(out.steer).toBeCloseTo(0.5, 9);
    expect(out.throttle).toBeCloseTo(0.8, 9);
    expect(out.brake).toBeCloseTo(0.3, 9);
  });

  it('AT2: axes[0] = 0.05 is inside the 0.08 deadzone so steer is 0', () => {
    const input = new GamepadInput(gamepads([fakePad([0.05, 0])]));
    input.update(DT);
    expect(input.getInput().steer).toBeCloseTo(0, 9);
  });

  it('AT3: buttons 4/5 fire shiftDown/shiftUp once per press, not while held', () => {
    const pad = fakePad();
    const input = new GamepadInput(gamepads([pad]));

    input.update(DT);
    expect(input.getInput().shiftDown).toBe(false);
    expect(input.getInput().shiftUp).toBe(false);

    pad.buttons[4].pressed = true;
    input.update(DT);
    expect(input.getInput().shiftDown).toBe(true);
    expect(input.getInput().shiftDown).toBe(false);

    pad.buttons[5].pressed = true;
    input.update(DT);
    expect(input.getInput().shiftUp).toBe(true);
    expect(input.getInput().shiftDown).toBe(false);
    expect(input.getInput().shiftUp).toBe(false);

    pad.buttons[4].pressed = false;
    pad.buttons[5].pressed = false;
    input.update(DT);
    expect(input.getInput().shiftDown).toBe(false);
    expect(input.getInput().shiftUp).toBe(false);

    pad.buttons[4].pressed = true;
    pad.buttons[5].pressed = true;
    input.update(DT);
    const again = input.getInput();
    expect(again.shiftDown).toBe(true);
    expect(again.shiftUp).toBe(true);
  });

  it('AT4: with no gamepad connected all values are zero and update does not throw', () => {
    const input = new GamepadInput(gamepads([null, null]));
    expect(() => input.update(DT)).not.toThrow();
    const out = input.getInput();
    expect(out.throttle).toBeCloseTo(0, 9);
    expect(out.brake).toBeCloseTo(0, 9);
    expect(out.steer).toBeCloseTo(0, 9);
    expect(out.reset).toBe(false);
    expect(out.shiftUp ?? false).toBe(false);
    expect(out.shiftDown ?? false).toBe(false);
  });

  it('AT5: mergeInputs keeps the larger magnitude per axis and ORs the flags', () => {
    const k: DriverInput = { throttle: 0.5, brake: 1, steer: -0.5, reset: true };
    const g: DriverInput = { throttle: 0.8, brake: 0.2, steer: 0.3, reset: false, shiftUp: true };
    const merged = mergeInputs(k, g);
    expect(merged.throttle).toBeCloseTo(0.8, 9);
    expect(merged.brake).toBeCloseTo(1, 9);
    expect(merged.steer).toBeCloseTo(-0.5, 9);
    expect(merged.reset).toBe(true);
    expect(merged.shiftUp).toBe(true);
  });
});

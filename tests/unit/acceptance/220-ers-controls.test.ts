import { describe, it, expect } from 'vitest';
import { KeyboardInput } from '../../../src/input/keyboard';
import { GamepadInput, mergeInputs } from '../../../src/input/gamepad';
import type { DriverInput } from '../../../src/core/types';

const DT = 1 / 120;

const key = (type: string, code: string, repeat = false) =>
  Object.assign(new Event(type), { code, repeat });

function freshKeyboard(): { target: EventTarget; input: KeyboardInput } {
  const target = new EventTarget();
  return { target, input: new KeyboardInput(target) };
}

interface FakeButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

interface FakePad {
  axes: number[];
  buttons: FakeButton[];
}

function fakePad(buttonCount = 8): FakePad {
  return {
    axes: [0, 0],
    buttons: Array.from({ length: buttonCount }, (): FakeButton => ({ pressed: false, touched: false, value: 0 })),
  };
}

function gamepad(pad: FakePad): GamepadInput {
  return new GamepadInput(() => [pad] as unknown as Array<Gamepad | null>);
}

describe('220 overtake and ERS mode controls acceptance', () => {
  it('AT1: Space held keeps overtake true on both reads; Space up clears it', () => {
    const { target, input } = freshKeyboard();
    target.dispatchEvent(key('keydown', 'Space'));
    expect(input.update(DT).overtake).toBe(true);
    expect(input.update(DT).overtake).toBe(true);
    target.dispatchEvent(key('keyup', 'Space'));
    expect(input.update(DT).overtake ?? false).toBe(false);
  });

  it('AT2: one KeyB keydown held gives ersCycle true on the first of three reads only', () => {
    const { target, input } = freshKeyboard();
    target.dispatchEvent(key('keydown', 'KeyB'));
    expect(input.update(DT).ersCycle).toBe(true);
    expect(input.update(DT).ersCycle ?? false).toBe(false);
    expect(input.update(DT).ersCycle ?? false).toBe(false);
  });

  it('AT3: held pad button 0 keeps overtake true on both reads', () => {
    const pad = fakePad();
    pad.buttons[0].pressed = true;
    const input = gamepad(pad);
    input.update(DT);
    expect(input.getInput().overtake).toBe(true);
    expect(input.getInput().overtake).toBe(true);
  });

  it('AT4: pad button 3 held 3 updates gives ersCycle true on the first read only; release and press fires again', () => {
    const pad = fakePad();
    pad.buttons[3].pressed = true;
    const input = gamepad(pad);
    input.update(DT);
    expect(input.getInput().ersCycle).toBe(true);
    input.update(DT);
    expect(input.getInput().ersCycle ?? false).toBe(false);
    input.update(DT);
    expect(input.getInput().ersCycle ?? false).toBe(false);
    pad.buttons[3].pressed = false;
    input.update(DT);
    pad.buttons[3].pressed = true;
    input.update(DT);
    expect(input.getInput().ersCycle).toBe(true);
  });

  it('AT5: mergeInputs ORs overtake and ersCycle; both absent yields falsy', () => {
    const keyboard: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false, overtake: false };
    const pad: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false, overtake: true, ersCycle: true };
    const merged = mergeInputs(keyboard, pad);
    expect(merged.overtake).toBe(true);
    expect(merged.ersCycle).toBe(true);
    const bare: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
    const neither = mergeInputs(bare, { ...bare });
    expect(neither.overtake ?? false).toBe(false);
    expect(neither.ersCycle ?? false).toBe(false);
  });
});

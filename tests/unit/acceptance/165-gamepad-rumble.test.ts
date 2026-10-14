import { describe, expect, it, vi } from 'vitest';
import { GamepadInput } from '../../../src/input/gamepad';

interface PadMock {
  pad: Gamepad;
  playEffect: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}

function makePad(withActuator: boolean): PadMock {
  const playEffect = vi.fn(() => Promise.resolve(undefined));
  const reset = vi.fn(() => Promise.resolve(undefined));
  const raw: Record<string, unknown> = {
    axes: [0, 0],
    buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  if (withActuator) raw.vibrationActuator = { playEffect, reset };
  return { pad: raw as unknown as Gamepad, playEffect, reset };
}

function inputFor(...pads: Array<Gamepad | null>): GamepadInput {
  return new GamepadInput(() => pads);
}

describe('165 gamepad rumble acceptance', () => {
  it('AT1: first non-zero rumble plays dual-rumble once with the given magnitudes', () => {
    const { pad, playEffect } = makePad(true);
    const input = inputFor(pad);
    input.rumble(0.5, 0.2, 0);
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      startDelay: 0,
      duration: 120,
      strongMagnitude: 0.5,
      weakMagnitude: 0.2,
    });
  });

  it('AT2: change threshold and keepalive pacing give 3 plays over the sequence', () => {
    const { pad, playEffect } = makePad(true);
    const input = inputFor(pad);
    input.rumble(0.5, 0.2, 0);
    expect(playEffect).toHaveBeenCalledTimes(1);
    input.rumble(0.8, 0.2, 30);
    expect(playEffect).toHaveBeenCalledTimes(1);
    input.rumble(0.8, 0.2, 55);
    expect(playEffect).toHaveBeenCalledTimes(2);
    input.rumble(0.81, 0.2, 80);
    expect(playEffect).toHaveBeenCalledTimes(2);
    input.rumble(0.81, 0.2, 155);
    expect(playEffect).toHaveBeenCalledTimes(3);
    expect(playEffect.mock.calls[1]?.[1]).toMatchObject({
      strongMagnitude: 0.8,
      weakMagnitude: 0.2,
    });
    expect(playEffect.mock.calls[2]?.[1]).toMatchObject({
      strongMagnitude: 0.81,
      weakMagnitude: 0.2,
    });
  });

  it('AT3: non-zero to (0,0) resets once; repeated (0,0) does nothing', () => {
    const { pad, playEffect, reset } = makePad(true);
    const input = inputFor(pad);
    input.rumble(0.5, 0.2, 0);
    expect(playEffect).toHaveBeenCalledTimes(1);
    input.rumble(0, 0, 200);
    expect(reset).toHaveBeenCalledTimes(1);
    input.rumble(0, 0, 400);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(playEffect).toHaveBeenCalledTimes(1);
  });

  it('AT4: out-of-range and non-finite values clamp to 0..1', () => {
    const { pad, playEffect } = makePad(true);
    const input = inputFor(pad);
    input.rumble(2, NaN, 0);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      startDelay: 0,
      duration: 120,
      strongMagnitude: 1,
      weakMagnitude: 0,
    });
  });

  it('AT5: pad without vibrationActuator or no pads is a silent no-op', () => {
    const noAct = makePad(false);
    const inputA = inputFor(noAct.pad);
    expect(() => inputA.rumble(0.5, 0.5, 0)).not.toThrow();
    expect(noAct.playEffect).not.toHaveBeenCalled();
    expect(noAct.reset).not.toHaveBeenCalled();
    const inputB = inputFor();
    expect(() => inputB.rumble(0.5, 0.5, 0)).not.toThrow();
  });

  it('AT6: setRumbleEnabled(false) resets active rumble and later rumble calls are ignored', () => {
    const { pad, playEffect, reset } = makePad(true);
    const input = inputFor(pad);
    input.rumble(0.5, 0.2, 0);
    expect(playEffect).toHaveBeenCalledTimes(1);
    input.setRumbleEnabled(false);
    expect(reset).toHaveBeenCalledTimes(1);
    input.rumble(1, 1, 500);
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

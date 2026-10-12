import type { DriverInput } from '../core/types';

export const GAMEPAD_DEADZONE = 0.08;

const BUTTON_SHIFT_DOWN = 4;
const BUTTON_SHIFT_UP = 5;
const BUTTON_BRAKE = 6;
const BUTTON_THROTTLE = 7;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const largerMag = (a: number, b: number): number => (Math.abs(b) > Math.abs(a) ? b : a);

const buttonPressed = (pad: Gamepad, index: number): boolean => {
  const b = pad.buttons[index];
  return b ? b.pressed : false;
};

const buttonValue = (pad: Gamepad, index: number): number => {
  const b = pad.buttons[index];
  return b ? clamp(b.value, 0, 1) : 0;
};

export class GamepadInput {
  private shiftUpPending = false;
  private shiftDownPending = false;
  private prevShiftUp = false;
  private prevShiftDown = false;
  private steer = 0;
  private throttle = 0;
  private brake = 0;

  constructor(private getGamepads?: () => ArrayLike<Gamepad | null>) {
    if (!this.getGamepads && typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      this.getGamepads = navigator.getGamepads.bind(navigator);
    }
  }

  update(dt: number): void {
    void dt; // raw pad state, no frame-rate smoothing
    const pad = this.firstPad();
    if (!pad) {
      this.steer = 0;
      this.throttle = 0;
      this.brake = 0;
      this.prevShiftUp = false;
      this.prevShiftDown = false;
      return;
    }

    const x = pad.axes.length > 0 ? pad.axes[0] : 0;
    const axis = Number.isFinite(x) ? x : 0;
    this.steer = Math.abs(axis) < GAMEPAD_DEADZONE ? 0 : clamp(axis, -1, 1);
    this.throttle = buttonValue(pad, BUTTON_THROTTLE);
    this.brake = buttonValue(pad, BUTTON_BRAKE);

    const down = buttonPressed(pad, BUTTON_SHIFT_DOWN);
    if (down && !this.prevShiftDown) this.shiftDownPending = true;
    this.prevShiftDown = down;

    const up = buttonPressed(pad, BUTTON_SHIFT_UP);
    if (up && !this.prevShiftUp) this.shiftUpPending = true;
    this.prevShiftUp = up;
  }

  getInput(): DriverInput {
    const input: DriverInput = {
      throttle: this.throttle,
      brake: this.brake,
      steer: this.steer,
      reset: false,
      shiftUp: this.shiftUpPending,
      shiftDown: this.shiftDownPending,
    };
    this.shiftUpPending = false;
    this.shiftDownPending = false;
    return input;
  }

  private firstPad(): Gamepad | null {
    if (!this.getGamepads) return null;
    const pads = this.getGamepads();
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad) return pad;
    }
    return null;
  }
}

export function mergeInputs(a: DriverInput, b: DriverInput): DriverInput {
  return {
    throttle: largerMag(a.throttle, b.throttle),
    brake: largerMag(a.brake, b.brake),
    steer: largerMag(a.steer, b.steer),
    reset: a.reset || b.reset,
    shiftUp: (a.shiftUp ?? false) || (b.shiftUp ?? false),
    shiftDown: (a.shiftDown ?? false) || (b.shiftDown ?? false),
  };
}

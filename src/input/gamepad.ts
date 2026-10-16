import type { DriverInput } from '../core/types';

export const GAMEPAD_DEADZONE = 0.08;
export const TRIGGER_DEADZONE = 0.1;

const BUTTON_SHIFT_DOWN = 4;
const BUTTON_SHIFT_UP = 5;
const BUTTON_BRAKE = 6;
const BUTTON_THROTTLE = 7;
const BUTTON_SETUP_HUD = 8;

const RUMBLE_CHANGE_MS = 50;
const RUMBLE_KEEPALIVE_MS = 100;
const RUMBLE_CHANGE = 0.02;
const RUMBLE_DURATION_MS = 120;

const rumbleMagnitude = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

// Adopts a possibly non-promise return and swallows rejections (spec: ignore them).
const ignoreRejection = (result: unknown): void => {
  void Promise.resolve(result).catch(() => {});
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const largerMag = (a: number, b: number): number => (Math.abs(b) > Math.abs(a) ? b : a);

const triggerValue = (v: number): number => (v < TRIGGER_DEADZONE ? 0 : v);

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
  private setupHudPending = false;
  private prevShiftUp = false;
  private prevShiftDown = false;
  private prevSetupHud = false;
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private rumbleEnabled = true;
  private rumbleActive = false;
  private lastPlayMs = Number.NEGATIVE_INFINITY;
  private lastStrong = 0;
  private lastWeak = 0;

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
      this.prevSetupHud = false;
      return;
    }

    const x = pad.axes.length > 0 ? pad.axes[0] : 0;
    const axis = Number.isFinite(x) ? x : 0;
    this.steer = Math.abs(axis) < GAMEPAD_DEADZONE ? 0 : clamp(axis, -1, 1);
    this.throttle = triggerValue(buttonValue(pad, BUTTON_THROTTLE));
    this.brake = triggerValue(buttonValue(pad, BUTTON_BRAKE));

    const down = buttonPressed(pad, BUTTON_SHIFT_DOWN);
    if (down && !this.prevShiftDown) this.shiftDownPending = true;
    this.prevShiftDown = down;

    const up = buttonPressed(pad, BUTTON_SHIFT_UP);
    if (up && !this.prevShiftUp) this.shiftUpPending = true;
    this.prevShiftUp = up;

    const setupHud = buttonPressed(pad, BUTTON_SETUP_HUD);
    if (setupHud && !this.prevSetupHud) this.setupHudPending = true;
    this.prevSetupHud = setupHud;
  }

  /** Consumes the pending Back/Select/Share edge (setup HUD toggle). */
  takeSetupHudToggle(): boolean {
    const pending = this.setupHudPending;
    this.setupHudPending = false;
    return pending;
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

  rumble(low: number, high: number, nowMs: number): void {
    if (!this.rumbleEnabled) return;
    const strong = rumbleMagnitude(low);
    const weak = rumbleMagnitude(high);
    if (strong === 0 && weak === 0) {
      if (this.rumbleActive) {
        this.rumbleActive = false;
        this.resetRumble();
      }
      return;
    }
    const dt = nowMs - this.lastPlayMs;
    const changed = Math.abs(strong - this.lastStrong) > RUMBLE_CHANGE || Math.abs(weak - this.lastWeak) > RUMBLE_CHANGE;
    if (!((dt >= RUMBLE_CHANGE_MS && changed) || dt >= RUMBLE_KEEPALIVE_MS)) return;
    const actuator = this.actuator();
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    ignoreRejection(
      actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: RUMBLE_DURATION_MS,
        strongMagnitude: strong,
        weakMagnitude: weak,
      }),
    );
    this.lastPlayMs = nowMs;
    this.lastStrong = strong;
    this.lastWeak = weak;
    this.rumbleActive = true;
  }

  setRumbleEnabled(on: boolean): void {
    if (on === this.rumbleEnabled) return;
    this.rumbleEnabled = on;
    if (!on && this.rumbleActive) {
      this.rumbleActive = false;
      this.resetRumble();
    }
  }

  private actuator(): GamepadHapticActuator | null {
    const pad = this.firstPad();
    return pad ? (pad.vibrationActuator ?? null) : null;
  }

  private resetRumble(): void {
    const actuator = this.actuator();
    if (!actuator || typeof actuator.reset !== 'function') return;
    ignoreRejection(actuator.reset());
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

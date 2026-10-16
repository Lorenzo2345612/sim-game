import type { DriverInput } from '../core/types';

export function approach(current: number, target: number, ratePerSecond: number, dt: number): number {
  const maxDelta = ratePerSecond * dt;
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

const THROTTLE_KEYS = ['KeyW', 'ArrowUp'];
const BRAKE_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];

export class KeyboardInput {
  private pressed = new Set<string>();
  private resetPending = false;
  private ersCyclePending = false;
  private throttle = 0;
  private brake = 0;
  private steer = 0;

  private onKeyDown = (event: Event): void => {
    const code = (event as KeyboardEvent).code;
    if (code === 'KeyR' && !(event as KeyboardEvent).repeat && !this.pressed.has('KeyR')) {
      this.resetPending = true;
    }
    if (code === 'KeyB' && !(event as KeyboardEvent).repeat && !this.pressed.has('KeyB')) {
      this.ersCyclePending = true;
    }
    this.pressed.add(code);
    if ((code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight' ||
        code === 'Space') &&
        typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };

  private onKeyUp = (event: Event): void => {
    this.pressed.delete((event as KeyboardEvent).code);
  };

  private onBlur = (): void => {
    this.pressed.clear();
  };

  constructor(private target: EventTarget) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  update(dt: number): DriverInput {
    const tThrottle = THROTTLE_KEYS.some((k) => this.pressed.has(k)) ? 1 : 0;
    const tBrake = BRAKE_KEYS.some((k) => this.pressed.has(k)) ? 1 : 0;
    const left = LEFT_KEYS.some((k) => this.pressed.has(k));
    const right = RIGHT_KEYS.some((k) => this.pressed.has(k));
    const tSteer = (right ? 1 : 0) - (left ? 1 : 0);

    this.throttle = approach(this.throttle, tThrottle, tThrottle > this.throttle ? 4 : 6, dt);
    this.brake = approach(this.brake, tBrake, tBrake > this.brake ? 6 : 8, dt);
    const rate = (Math.abs(tSteer) < Math.abs(this.steer) ||
      Math.sign(tSteer) !== Math.sign(this.steer)) && this.steer !== 0 ? 5 : 3;
    this.steer = approach(this.steer, tSteer, rate, dt);

    const reset = this.resetPending;
    this.resetPending = false;
    const ersCycle = this.ersCyclePending;
    this.ersCyclePending = false;
    return {
      throttle: this.throttle, brake: this.brake, steer: this.steer, reset,
      overtake: this.pressed.has('Space'), ersCycle,
    };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

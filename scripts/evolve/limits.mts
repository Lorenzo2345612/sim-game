// Track-limit rules for the trainer: sampled per car every 4 physics steps.
export interface TrackLimitsState {
  step(offWheels: number, dt: number): void;
  readonly lapValid: boolean;
  readonly eliminated: boolean;
  newLap(): void;
}

export function trackLimits(): TrackLimitsState {
  let valid = true, gone = false, offT = 0;
  return {
    step(offWheels: number, dt: number): void {
      if (offWheels >= 4) {
        valid = false;
        offT += dt;
        if (offT > 2.0) gone = true;
      } else offT = 0;
    },
    get lapValid() { return valid; },
    get eliminated() { return gone; },
    newLap() { valid = true; },
  };
}

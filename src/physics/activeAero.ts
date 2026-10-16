import type { ActiveAeroSpec } from './hybridTypes';

export class ActiveAero {
  blend = 0;
  private readonly transitionS: number;

  constructor(spec: ActiveAeroSpec) {
    this.transitionS = spec.transitionS;
  }

  update(inZone: boolean, throttle: number, brake: number, dt: number): number {
    const target = inZone && throttle >= 0.9 && brake < 0.05 ? 1 : 0;
    const step = dt / this.transitionS;
    let b = this.blend;
    if (target > b) b = Math.min(target, b + step);
    else if (target < b) b = Math.max(target, b - step);
    // absorb float residue so full transitions end exactly on the target
    if (Math.abs(b - target) < 1e-12) b = target;
    this.blend = Math.min(1, Math.max(0, b));
    return this.blend;
  }

  reset(): void {
    this.blend = 0;
  }

  get straightMode(): boolean {
    return this.blend >= 0.5 - 1e-9;
  }
}

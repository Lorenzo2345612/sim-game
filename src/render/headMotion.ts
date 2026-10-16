const TAU_S = 0.15;
const MAX_OFFSET_M = 0.04;
const GAIN_M_PER_G = 0.012;

/** Cockpit head offset (car-frame metres, x right, z back) low-passed toward clamped g targets. */
export class HeadMotion {
  private readonly out = { x: 0, z: 0 };

  update(latG: number, longG: number, dt: number): { x: number; z: number } {
    if (!(dt > 0)) return this.out;
    const tx = Math.min(MAX_OFFSET_M, Math.max(-MAX_OFFSET_M, -GAIN_M_PER_G * latG));
    const tz = Math.min(MAX_OFFSET_M, Math.max(-MAX_OFFSET_M, GAIN_M_PER_G * longG));
    const k = 1 - Math.exp(-dt / TAU_S);
    this.out.x += (tx - this.out.x) * k;
    this.out.z += (tz - this.out.z) * k;
    return this.out;
  }
}

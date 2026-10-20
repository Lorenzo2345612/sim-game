const FIRE_AFTER_S = 10;
const RESET_AFTER_S = 3;
const NEAR_M = 100;

export class BlueFlagTimer {
  private lapper = -1;
  private near = 0;
  private away = 0;
  private fired = false;

  update(lapper: number, gap: number, dt: number): boolean {
    if (lapper === -1) {
      this.away += dt;
      if (this.away >= RESET_AFTER_S - 1e-9) {
        this.lapper = -1;
        this.near = 0;
        this.fired = false;
      }
      return false;
    }
    this.away = 0;
    if (lapper !== this.lapper) {
      this.lapper = lapper;
      this.near = 0;
      this.fired = false;
    }
    if (gap > NEAR_M) return false;
    this.near += dt;
    if (!this.fired && this.near >= FIRE_AFTER_S - 1e-9) {
      this.fired = true;
      return true;
    }
    return false;
  }
}

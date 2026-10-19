export class AttackMode {
  private left: number;
  private start = Number.NaN;

  constructor(
    private readonly activations = 2,
    private readonly durationS = 240,
  ) {
    this.left = activations;
  }

  tryActivate(lap: number, vsc: boolean, time: number): boolean {
    if (Number.isNaN(lap) || Number.isNaN(time)) return false;
    if (lap < 2 || vsc || this.left <= 0) return false;
    if (!Number.isNaN(this.start) && time >= this.start && time < this.start + this.durationS) return false;
    this.start = time;
    this.left -= 1;
    return true;
  }

  mode(time: number): 'race' | 'attack' {
    return this.isActive(time) ? 'attack' : 'race';
  }

  remainingS(time: number): number {
    return this.isActive(time) ? this.start + this.durationS - time : 0;
  }

  get activationsLeft(): number {
    return this.left;
  }

  private isActive(time: number): boolean {
    return !Number.isNaN(this.start) && time >= this.start && time < this.start + this.durationS;
  }
}

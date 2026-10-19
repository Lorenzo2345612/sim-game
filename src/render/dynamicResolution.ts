import type { Preset } from '../core/settings';

export interface DynamicResolutionOptions {
  initial: number;
  max: number;
  /** Lower bound for the ratio; defaults to 0.6. */
  min?: number;
}

/** Frames per evaluation window; target frame time is 16.7 ms (informational). */
const WINDOW = 60;

function p50(sorted: Float64Array, n: number): number {
  const pos = (n - 1) / 2;
  const lo = Math.floor(pos);
  return sorted[lo] + (pos - lo) * (sorted[lo + 1] - sorted[lo]);
}

/** Steps the pixel ratio from the median frame time; update never allocates. */
export class DynamicResolution {
  private readonly samples = new Float64Array(WINDOW);
  private readonly sorted = new Float64Array(WINDOW);
  private readonly min: number;
  private readonly max: number;
  private count = 0;
  private current: number;

  constructor(opts: DynamicResolutionOptions) {
    this.current = opts.initial;
    this.max = opts.max;
    this.min = opts.min ?? 0.6;
  }

  get ratio(): number {
    return this.current;
  }

  update(frameMs: number): number {
    if (!Number.isFinite(frameMs)) return this.current;
    this.samples[this.count] = frameMs;
    this.count++;
    if (this.count < WINDOW) return this.current;
    this.count = 0;
    this.sorted.set(this.samples);
    this.sorted.sort();
    const median = p50(this.sorted, WINDOW);
    if (median > 18) this.current = Math.max(this.current - 0.1, this.min);
    else if (median < 13) this.current = Math.min(this.current + 0.05, this.max);
    return this.current;
  }
}

const ORDER: Record<Preset, number> = { low: 0, medium: 1, high: 2 };

function median(samples: readonly number[]): number {
  const sorted = Float64Array.from(samples);
  sorted.sort();
  return p50(sorted, sorted.length);
}

/** Target preset from the median frame time (ms); never raises above `current`. */
export function autoPreset(samples: readonly number[], current: Preset = 'high'): Preset {
  if (samples.length < 60) return current;
  const ms = median(samples);
  const target: Preset = ms > 25 ? 'low' : ms > 18 ? 'medium' : current;
  return ORDER[target] <= ORDER[current] ? target : current;
}

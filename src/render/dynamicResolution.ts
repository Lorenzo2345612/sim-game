import type { Preset } from '../core/settings';

export interface DynamicResolutionOptions {
  initial: number;
  max: number;
  /** Lower bound for the ratio; defaults to 0.75. */
  min?: number;
}

/** Frames per evaluation window. */
const WINDOW = 60;
const PERIODS = [1000 / 60, 1000 / 120, 1000 / 144];
const HISTORY = 5;
const DOWN_FACTOR = 1.25;
const UP_FACTOR = 1.05;
const DOWN_WINDOWS = 2;
const UP_WINDOWS = 3;
const STEP = 0.1;
/** Minimum time between ratio changes: each one reallocates the render targets. */
const COOLDOWN_MS = 2000;

function p50(sorted: Float64Array, n: number): number {
  const pos = (n - 1) / 2;
  const lo = Math.floor(pos);
  return sorted[lo] + (pos - lo) * (sorted[Math.min(lo + 1, n - 1)] - sorted[lo]);
}

function snapPeriod(ms: number): number {
  let best = PERIODS[0];
  for (let i = 1; i < PERIODS.length; i++) if (Math.abs(PERIODS[i] - ms) < Math.abs(best - ms)) best = PERIODS[i];
  return best;
}

/**
 * Steps the pixel ratio from the median frame time relative to the estimated display period
 * (vsync-capped frames sit at the period, so they never read as "fast"); update never allocates.
 */
export class DynamicResolution {
  private readonly samples = new Float64Array(WINDOW);
  private readonly renderSamples = new Float64Array(WINDOW);
  private readonly sorted = new Float64Array(WINDOW);
  private readonly history = new Float64Array(HISTORY);
  private histCount = 0;
  private readonly min: number;
  private readonly max: number;
  private count = 0;
  private current: number;
  private clock = 0;
  private lastChange = -Infinity;
  private slowStreak = 0;
  private fastStreak = 0;
  private renderMedian = 0;
  private period = PERIODS[0];

  constructor(opts: DynamicResolutionOptions) {
    this.max = opts.max;
    this.min = Math.min(opts.min ?? 0.75, this.max);
    this.current = Math.min(Math.max(opts.initial, this.min), this.max);
  }

  get ratio(): number {
    return this.current;
  }

  /** Median renderer submit time (ms) of the last window; informational. */
  get renderMs(): number {
    return this.renderMedian;
  }

  /** Estimated display period (ms), snapped to 60/120/144 Hz. */
  get displayPeriodMs(): number {
    return this.period;
  }

  update(frameMs: number, renderMs = 0): number {
    if (!Number.isFinite(frameMs)) return this.current;
    this.clock += frameMs;
    this.samples[this.count] = frameMs;
    this.renderSamples[this.count] = Number.isFinite(renderMs) ? renderMs : 0;
    this.count++;
    if (this.count < WINDOW) return this.current;
    this.count = 0;
    this.sorted.set(this.renderSamples);
    this.sorted.sort();
    this.renderMedian = p50(this.sorted, WINDOW);
    this.sorted.set(this.samples);
    this.sorted.sort();
    const median = p50(this.sorted, WINDOW);

    this.history[this.histCount % HISTORY] = median;
    this.histCount++;
    let lo = Infinity;
    const n = Math.min(this.histCount, HISTORY);
    for (let i = 0; i < n; i++) if (this.history[i] < lo) lo = this.history[i];
    this.period = snapPeriod(lo);

    if (median > this.period * DOWN_FACTOR) {
      this.slowStreak++;
      this.fastStreak = 0;
    } else if (median <= this.period * UP_FACTOR) {
      this.fastStreak++;
      this.slowStreak = 0;
    } else {
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
    if (this.clock - this.lastChange < COOLDOWN_MS) return this.current;
    if (this.slowStreak >= DOWN_WINDOWS && this.current > this.min) {
      this.current = Math.max(Math.round((this.current - STEP) * 100) / 100, this.min);
      this.changed();
    } else if (this.fastStreak >= UP_WINDOWS && this.current < this.max) {
      this.current = Math.min(Math.round((this.current + STEP) * 100) / 100, this.max);
      this.changed();
    }
    return this.current;
  }

  private changed(): void {
    this.lastChange = this.clock;
    this.slowStreak = 0;
    this.fastStreak = 0;
  }
}

function median(samples: readonly number[]): number {
  const sorted = Float64Array.from(samples);
  sorted.sort();
  return p50(sorted, sorted.length);
}

/** Auto-preset thresholds: one level down only, when the median frame exceeds this. */
export const AUTO_PRESET_SLOW_MS = 22;
/** Frames longer than this (loading, tab switches) are not representative. */
export const AUTO_PRESET_IGNORE_MS = 100;

const LOWER: Record<Preset, Preset> = { low: 'low', medium: 'low', high: 'medium' };

/** Preset after the sampling window: one level below `current` if the median frame is slow, else `current`. */
export function autoPreset(samples: readonly number[], current: Preset = 'high'): Preset {
  const kept = samples.filter((v) => Number.isFinite(v) && v <= AUTO_PRESET_IGNORE_MS);
  if (kept.length < 60) return current;
  return median(kept) > AUTO_PRESET_SLOW_MS ? LOWER[current] : current;
}

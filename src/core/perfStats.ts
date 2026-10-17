export interface Percentiles {
  p50: number;
  p95: number;
}

export interface PerfStats {
  fps: number;
  frameMs: Percentiles;
  simMs: Percentiles;
  renderMs: Percentiles;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

/** Linear interpolation at position p·(n−1) of an ascending sorted sample. */
function rankPercentile(sorted: Float64Array, n: number, p: number): number {
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = lo + 1 < n ? lo + 1 : lo;
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** Fixed-capacity ring of frame times; push never allocates. */
export class FrameRing {
  private readonly buf: Float64Array;
  private readonly scratch: Float64Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 300) {
    this.buf = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.buf[this.head] = ms;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }

  percentiles(): Percentiles {
    const n = this.count;
    if (n === 0) return { p50: 0, p95: 0 };
    const start = (this.head + this.buf.length - n) % this.buf.length;
    for (let i = 0; i < n; i++) this.scratch[i] = this.buf[(start + i) % this.buf.length];
    const sorted = this.scratch.subarray(0, n);
    sorted.sort();
    return { p50: rankPercentile(sorted, n, 0.5), p95: rankPercentile(sorted, n, 0.95) };
  }
}

import type { EngineSynthSpec } from './soundSpec';

export interface VoiceControl {
  rpm: number;
  load: number;
  throttle: number;
  wheelSpeedMs: number;
  limiter: boolean;
}

export const RPM_SLEW_S = 0.02;
export const LOAD_SLEW_S = 0.03;
export const WHEEL_RADIUS_M = 0.33;

const CYCLE_DEG = 720;
const MIN_PULSE_S = 0.0003;
const MAX_PULSE_S = 0.008;
const KERNEL_N = 2048;
const REFLECTION = -0.85;
const LOOP_LP_HZ = 3500;
const DC_CORNER_HZ = 10;
const PRE_GAIN = 1.2;
const PULSE_SCALE = 0.05;
const NEG_CEIL = 0.75;
const PEAK = 0.9;

// Fast Hann rise then quadratic decay, u in [0,1], one guard entry for interpolation.
const RISE = 0.35;
const KERNEL = new Float64Array(KERNEL_N + 2);
for (let i = 0; i <= KERNEL_N; i++) {
  const u = i / KERNEL_N;
  if (u < RISE) KERNEL[i] = 0.5 * (1 - Math.cos((Math.PI * u) / RISE));
  else {
    const d = (1 - u) / (1 - RISE);
    KERNEL[i] = d * d;
  }
}

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pow2AtLeast(n: number): number {
  let p = 16;
  while (p < n) p <<= 1;
  return p;
}

export class EngineVoice {
  private readonly fs: number;
  private readonly seed: number;
  private readonly cyl: number;
  private readonly firing: Float64Array;
  private readonly eff: Float64Array;
  private readonly bankOf: Uint8Array;
  private readonly injMask: number;
  private readonly inj: [Float64Array, Float64Array];
  private readonly tubeMask: number;
  private readonly tube: [Float64Array, Float64Array, Float64Array];
  private readonly dInt: [number, number, number];
  private readonly dFrac: [number, number, number];
  private readonly lpState = new Float64Array(3);
  private readonly aLp: number;
  private readonly aRpm: number;
  private readonly aLoad: number;
  private readonly dcR: number;
  private readonly gain: number;
  private readonly pulseDeg: number;
  private readonly jitterDeg: number;
  private readonly jitterAmp: number;
  private readonly drive: number;

  private rng: () => number = () => 0;
  private spare = 0;
  private hasSpare = false;
  private tRpm = 0;
  private tLoad = 0;
  private rpm = 0;
  private load = 0;
  private angle = 0;
  private head = 0;
  private prevTail = 0;
  private dcIn1 = 0;
  private dcOut1 = 0;
  private dc2In1 = 0;
  private dc2Out1 = 0;
  private clipPrev = 0;
  private clipMidPrev = 0;
  private clipCurPrev = 0;
  throttle = 0;
  wheelSpeedMs = 0;
  limiter = false;

  constructor(spec: EngineSynthSpec, sampleRate: number, seed: number) {
    if (!(sampleRate > 0) || !Number.isFinite(sampleRate)) throw new Error('sampleRate must be > 0');
    this.fs = sampleRate;
    this.seed = seed;
    this.cyl = spec.firingDeg.length;
    this.firing = Float64Array.from(spec.firingDeg);
    this.eff = new Float64Array(this.cyl);
    this.bankOf = Uint8Array.from(spec.bank.map((b) => (b ? 1 : 0)));
    this.injMask = pow2AtLeast(Math.ceil(MAX_PULSE_S * sampleRate) + 4) - 1;
    this.inj = [new Float64Array(this.injMask + 1), new Float64Array(this.injMask + 1)];
    const gas = spec.gasSpeedMs;
    const delays = [
      ((2 * spec.pipeM[0]) / gas) * sampleRate,
      ((2 * spec.pipeM[1]) / gas) * sampleRate,
      ((2 * spec.tailM) / gas) * sampleRate,
    ].map((d) => Math.max(2, d));
    this.tubeMask = pow2AtLeast(Math.ceil(Math.max(...delays)) + 4) - 1;
    const size = this.tubeMask + 1;
    this.tube = [new Float64Array(size), new Float64Array(size), new Float64Array(size)];
    this.dInt = [Math.floor(delays[0]), Math.floor(delays[1]), Math.floor(delays[2])];
    this.dFrac = [delays[0] - this.dInt[0], delays[1] - this.dInt[1], delays[2] - this.dInt[2]];
    this.aLp = 1 - Math.exp((-2 * Math.PI * LOOP_LP_HZ) / sampleRate);
    this.aRpm = 1 - Math.exp(-1 / (RPM_SLEW_S * sampleRate));
    this.aLoad = 1 - Math.exp(-1 / (LOAD_SLEW_S * sampleRate));
    this.dcR = 1 - (2 * Math.PI * DC_CORNER_HZ) / sampleRate;
    this.gain = Math.pow(10, spec.gainDb / 20);
    this.pulseDeg = spec.pulseDeg;
    this.jitterDeg = spec.jitterDeg;
    this.jitterAmp = spec.jitterAmp;
    this.drive = spec.drive;
    this.reset();
  }

  setControl(c: VoiceControl): void {
    this.tRpm = Number.isFinite(c.rpm) && c.rpm > 0 ? c.rpm : 0;
    const l = Number.isFinite(c.load) ? c.load : 0;
    this.tLoad = l < 0 ? 0 : l > 1 ? 1 : l;
    this.throttle = c.throttle;
    this.wheelSpeedMs = c.wheelSpeedMs;
    this.limiter = c.limiter;
  }

  reset(): void {
    this.rng = mulberry32(this.seed);
    this.hasSpare = false;
    this.spare = 0;
    this.tRpm = 0;
    this.tLoad = 0;
    this.rpm = 0;
    this.load = 0;
    this.angle = 0;
    this.head = 0;
    this.prevTail = 0;
    this.dcIn1 = 0;
    this.dcOut1 = 0;
    this.dc2In1 = 0;
    this.dc2Out1 = 0;
    this.clipPrev = 0;
    this.clipMidPrev = 0;
    this.clipCurPrev = 0;
    this.throttle = 0;
    this.wheelSpeedMs = 0;
    this.limiter = false;
    this.lpState.fill(0);
    this.inj[0].fill(0);
    this.inj[1].fill(0);
    for (let i = 0; i < 3; i++) this.tube[i].fill(0);
    this.redrawJitter();
  }

  private gauss(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = this.rng();
    if (u < 1e-12) u = 1e-12;
    const v = this.rng();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    this.hasSpare = true;
    return r * Math.cos(2 * Math.PI * v);
  }

  private redrawJitter(): void {
    for (let i = 0; i < this.cyl; i++) {
      let f = this.firing[i];
      if (this.jitterDeg > 0) f += this.jitterDeg * this.gauss();
      this.eff[i] = f < 0 ? 0 : f > 719.999 ? 719.999 : f;
    }
  }

  private fire(i: number, frac: number): void {
    const a = (0.25 + 0.75 * this.load) * (1 + (this.jitterAmp > 0 ? this.jitterAmp * this.gauss() : 0));
    let widthS = this.pulseDeg / (6 * this.rpm);
    widthS = widthS < MIN_PULSE_S ? MIN_PULSE_S : widthS > MAX_PULSE_S ? MAX_PULSE_S : widthS;
    const w = widthS * this.fs;
    const amp = a * w * PULSE_SCALE;
    const buf = this.inj[this.bankOf[i]];
    const mask = this.injMask;
    const scale = KERNEL_N / w;
    let pos = (1 - frac) * scale;
    for (let m = 0; pos < KERNEL_N; m++, pos += scale) {
      const k = Math.floor(pos);
      const t = pos - k;
      const v = KERNEL[k] + t * (KERNEL[k + 1] - KERNEL[k]);
      buf[(this.head + m) & mask] += amp * v;
    }
  }

  private clip(x: number): number {
    const v = x * this.drive;
    return v >= 0 ? Math.tanh(v) : NEG_CEIL * Math.tanh(v / NEG_CEIL);
  }

  render(out: Float32Array): void {
    const n = out.length;
    const fs = this.fs;
    const tubeMask = this.tubeMask;
    const injMask = this.injMask;
    const R = this.dcR;
    const cyl = this.cyl;
    for (let s = 0; s < n; s++) {
      this.rpm += (this.tRpm - this.rpm) * this.aRpm;
      this.load += (this.tLoad - this.load) * this.aLoad;
      const d = (this.rpm * 6) / fs;
      if (d > 1e-9) {
        const a0 = this.angle;
        const a1 = a0 + d;
        if (a1 >= CYCLE_DEG) {
          for (let i = 0; i < cyl; i++) {
            const f = this.eff[i];
            if (f > a0) this.fire(i, (f - a0) / d);
          }
          this.angle = a1 - CYCLE_DEG;
          this.redrawJitter();
          for (let i = 0; i < cyl; i++) {
            const f = this.eff[i];
            if (f <= this.angle) this.fire(i, (CYCLE_DEG - a0 + f) / d);
          }
        } else {
          for (let i = 0; i < cyl; i++) {
            const f = this.eff[i];
            if (f > a0 && f <= a1) this.fire(i, (f - a0) / d);
          }
          this.angle = a1;
        }
      }

      const h = this.head & injMask;
      const w = this.head & tubeMask;
      const x0 = this.inj[0][h];
      const x1 = this.inj[1][h];
      this.inj[0][h] = 0;
      this.inj[1][h] = 0;
      this.head++;

      const y0 = this.tubeStep(0, x0, w);
      const y1 = this.tubeStep(1, x1, w);
      const tail = this.tubeStep(2, 0.5 * (y0 + y1), w);

      const rad = (tail - this.prevTail) * PRE_GAIN;
      this.prevTail = tail;
      const dc = rad - this.dcIn1 + R * this.dcOut1;
      this.dcIn1 = rad;
      this.dcOut1 = dc;

      // 2x oversampled clip; 3-tap half-band decimation with one sample of latency
      const mid = this.clip(0.5 * (this.clipPrev + dc));
      const cur = this.clip(dc);
      this.clipPrev = dc;
      const y = 0.5 * this.clipCurPrev + 0.25 * (this.clipMidPrev + mid);
      this.clipMidPrev = mid;
      this.clipCurPrev = cur;

      const o = y - this.dc2In1 + R * this.dc2Out1;
      this.dc2In1 = y;
      this.dc2Out1 = o;
      out[s] = PEAK * Math.tanh((o * this.gain) / PEAK);
    }
  }

  private tubeStep(t: number, x: number, w: number): number {
    const buf = this.tube[t];
    const mask = this.tubeMask;
    const idx = (w - this.dInt[t]) & mask;
    const s0 = buf[idx];
    const s1 = buf[(idx - 1) & mask];
    const delayed = s0 + this.dFrac[t] * (s1 - s0);
    this.lpState[t] += this.aLp * (delayed - this.lpState[t]);
    const y = x + REFLECTION * this.lpState[t];
    buf[w] = y;
    return y;
  }
}

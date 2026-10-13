export interface EngineSynthParams {
  cylinders: number;
  exhaustLengthM: number;
  intakeMix: number;
  sampleRate: number;
}

const INTAKE_HZ = 800;
const COMB_FEEDBACK = 0.5;
const SOUND_SPEED = 343;

export function firingHz(rpm: number, cylinders: number): number {
  return (Math.max(0, rpm) / 60) * (cylinders / 2);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finiteOrZero = (v: number): number => (Number.isFinite(v) ? v : 0);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class EngineSynth {
  private readonly cylinders: number;
  private readonly sampleRate: number;
  private readonly intakeMix: number;
  private readonly jitter: Float64Array;
  private readonly comb: Float64Array;
  private readonly combDelay: number;
  private readonly rand: () => number;
  private combIndex = 0;
  private phase = 0;
  private envelope = 0;
  private burstDecay = 1;
  private cylinder = 0;
  private noiseLp = 0;
  private prevRpm = 0;
  private prevThrottle = 0;
  private hasPrev = false;

  constructor(p: EngineSynthParams, seed: number) {
    if (!Number.isInteger(p.cylinders) || p.cylinders < 1 || p.cylinders > 12) {
      throw new Error('EngineSynth: cylinders must be an integer in 1..12');
    }
    if (!Number.isFinite(p.sampleRate) || p.sampleRate <= 0) {
      throw new Error('EngineSynth: sampleRate must be > 0');
    }
    this.cylinders = p.cylinders;
    this.sampleRate = p.sampleRate;
    this.intakeMix = p.intakeMix;
    const d = Math.round((2 * p.exhaustLengthM / SOUND_SPEED) * p.sampleRate);
    this.combDelay = Number.isFinite(d) && d > 0 ? d : 1;
    this.comb = new Float64Array(this.combDelay);
    this.rand = mulberry32(seed);
    this.jitter = new Float64Array(p.cylinders);
    for (let i = 0; i < p.cylinders; i++) this.jitter[i] = this.rand() * 2 - 1;
  }

  render(out: Float32Array, rpm: number, throttle: number): void {
    const rpmEnd = Math.max(0, finiteOrZero(rpm));
    const thrEnd = clamp01(finiteOrZero(throttle));
    const rpmStart = this.hasPrev ? this.prevRpm : rpmEnd;
    const thrStart = this.hasPrev ? this.prevThrottle : thrEnd;
    const n = out.length;
    const intakeA = 1 - Math.exp((-2 * Math.PI * INTAKE_HZ) / this.sampleRate);
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      const rpmI = rpmStart + (rpmEnd - rpmStart) * t;
      const thrI = thrStart + (thrEnd - thrStart) * t;

      const fh = firingHz(rpmI, this.cylinders);
      this.phase += fh / this.sampleRate;
      if (this.phase >= 1) {
        this.phase -= Math.floor(this.phase);
        this.envelope = (0.2 + 0.8 * thrI) * (1 + 0.1 * this.jitter[this.cylinder]);
        // τ = 0.25 / fh s → per-sample decay of the exponential burst
        this.burstDecay = Math.exp((-4 * fh) / this.sampleRate);
        this.cylinder = (this.cylinder + 1) % this.cylinders;
      }
      const burst = this.envelope;
      this.envelope *= this.burstDecay;

      const delayed = this.comb[this.combIndex];
      const exhaust = burst + COMB_FEEDBACK * delayed;
      this.comb[this.combIndex] = exhaust;
      this.combIndex = (this.combIndex + 1) % this.combDelay;

      const white = this.rand() * 2 - 1;
      this.noiseLp += intakeA * (white - this.noiseLp);
      const intake = this.noiseLp * this.intakeMix * thrI;

      out[i] = Math.tanh(exhaust + intake);
    }
    this.prevRpm = rpmEnd;
    this.prevThrottle = thrEnd;
    this.hasPrev = true;
  }
}

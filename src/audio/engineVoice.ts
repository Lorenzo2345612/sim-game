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
const MAX_RUNNER_S = 0.0025;
const KERNEL_N = 2048;
export const REFLECTION = -0.25;
export const LOOP_LP_HZ = 1800;
const DC_CORNER_HZ = 10;
const PRE_GAIN = 1.2;
const PULSE_SCALE = 0.05;
const NEG_CEIL = 0.75;
const PEAK = 0.9;
const TWO_PI = 2 * Math.PI;
const BUTTER_Q = 0.707;
const TURBO_Q = 4;
const TURBO_AMP = 4.2;
const INTAKE_Q = 5;
const INTAKE_AMP = 2.5;
const INTAKE_WINDOW_DEG = 180;
const INTAKE_EDGE_DEG = 30;
const CRACKLE_THR = 0.05;
const ARM_THR = 0.5;
const POP_RPM = 3500;
const CRACKLE_RATE = 20;
const POP_MIN_S = 0.08;
const POP_MAX_S = 2.2;
const POP_GAP_S = 0.025;
const POP_AMP = 2.2;
const RUNNER_GAIN = -0.35;
const BASS_HZ = 160;
const LP_MAX_HZ = 20000;
const MAX_FC_FRAC = 0.45;
const TRIG_RATE = 3;
const TRIG_MAX_DT_S = 0.02;
const TRIG_BOOST = 0.25;
const TRIG_REFRACTORY_S = 0.3;
const HISS_DELAY_S = 0.03;
const BOV_GAIN = 0.7;
const BPV_GAIN = 0.7 * 0.178;
const FLUTTER_GAIN = 0.5;
const FLUTTER_DELAY_S = 0.04;
const WG_HOLD = 0.316;
const WG_CHUFF = 1.0;
const WG_GATE_LOAD = 0.700001;
const WG_RAMP_S = 0.04;
const REF_TAU_S = 0.3;
// unit-RMS normalisation of the uniform-noise band-passes
const N_BOV = 0.3;
const N_BPV = 0.081;
const N_FLUTTER = 0.148;
const N_WG = 0.256;

// 4 % Hann rise then exp(-5d)(1-d) decay, u in [0,1], one guard entry for interpolation.
const RISE = 0.04;
export const PULSE_KERNEL = new Float64Array(KERNEL_N + 2);
for (let i = 0; i <= KERNEL_N; i++) {
  const u = i / KERNEL_N;
  if (u < RISE) PULSE_KERNEL[i] = 0.5 * (1 - Math.cos((Math.PI * u) / RISE));
  else {
    const d = (u - RISE) / (1 - RISE);
    PULSE_KERNEL[i] = Math.exp(-5 * d) * (1 - d);
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

// RBJ biquads as [b0, b2, a1, a2] (b1 = 0); state [x1, x2, y1, y2].
function bpCo(fc: number, q: number, fs: number, gain: number): Float64Array {
  const w0 = (TWO_PI * fc) / fs;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (alpha / a0) * gain;
  return Float64Array.of(b0, -b0, (-2 * c) / a0, (1 - alpha) / a0);
}

// RBJ low-pass as [b0, b1, b2, a1, a2]; state [x1, x2, y1, y2].
function lpCo(fc: number, q: number, fs: number): Float64Array {
  const w0 = (TWO_PI * fc) / fs;
  const c = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 - c) / 2 / a0;
  return Float64Array.of(b0, 2 * b0, b0, (-2 * c) / a0, (1 - alpha) / a0);
}

// RBJ low-shelf (S = 1) as [b0, b1, b2, a1, a2]; state [x1, x2, y1, y2].
function lsCo(fc: number, db: number, fs: number): Float64Array {
  const A = Math.pow(10, db / 40);
  const w0 = (TWO_PI * fc) / fs;
  const c = Math.cos(w0);
  const s = (Math.sin(w0) / 2) * Math.SQRT2;
  const sa = 2 * Math.sqrt(A) * s;
  const a0 = A + 1 + (A - 1) * c + sa;
  return Float64Array.of(
    (A * (A + 1 - (A - 1) * c + sa)) / a0,
    (2 * A * (A - 1 - (A + 1) * c)) / a0,
    (A * (A + 1 - (A - 1) * c - sa)) / a0,
    (-2 * (A - 1 + (A + 1) * c)) / a0,
    (A + 1 + (A - 1) * c - sa) / a0,
  );
}

function bqStep(co: Float64Array, st: Float64Array, x: number): number {
  const y = co[0] * x + co[1] * st[0] + co[2] * st[1] - co[3] * st[2] - co[4] * st[3];
  st[1] = st[0];
  st[0] = x;
  st[3] = st[2];
  st[2] = y;
  return y;
}

function biquad(
  co: Float64Array,
  ci: number,
  st: Float64Array,
  si: number,
  x: number,
): number {
  const y = co[ci] * x + co[ci + 1] * st[si + 1] - co[ci + 2] * st[si + 2] - co[ci + 3] * st[si + 3];
  st[si + 1] = st[si];
  st[si] = x;
  st[si + 3] = st[si + 2];
  st[si + 2] = y;
  return y;
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
  private readonly cylVar: number;
  private readonly exhaustGain: number;
  private readonly cylAmp: Float64Array;
  private readonly cylOff: Float64Array;
  private readonly cylRunner: Float64Array;
  private readonly intakeGain: number;
  private readonly intakeCo: Float64Array;
  private readonly intakeSt = new Float64Array(4);
  private readonly blockN: number;
  private readonly blockCo: Float64Array;
  private readonly blockSt: Float64Array;
  private readonly lpOn: boolean;
  private readonly lpCo: Float64Array;
  private readonly lpSt = new Float64Array(4);
  private readonly lp2St = new Float64Array(4);
  private readonly turboStage: boolean;
  private readonly shelfOn: boolean;
  private readonly shelfCo: Float64Array;
  private readonly shelfSt = new Float64Array(4);
  private readonly turboGain: number;
  private readonly turboCenter: number;
  private readonly turboSpan: number;
  private readonly aBoost: number;
  private readonly turboLag0: boolean;
  private readonly downLag0: boolean;
  private readonly aDown: number;
  private readonly valve: number;
  private readonly flutterAmt: number;
  private readonly wgAmt: number;
  private readonly hasTrans: boolean;
  private readonly aRef: number;
  private readonly dHw: number;
  private readonly flCo: Float64Array;
  private readonly wgCo: Float64Array;
  private readonly flSt = new Float64Array(4);
  private readonly wgSt = new Float64Array(4);
  private readonly hsCo1 = new Float64Array(4);
  private readonly hsCo2 = new Float64Array(4);
  private readonly hsSt1 = new Float64Array(4);
  private readonly hsSt2 = new Float64Array(4);
  private readonly turboSt = new Float64Array(4);
  private readonly whineGain: number;
  private readonly whineOrder: number;
  private readonly whineWheel: boolean;
  private readonly whineMin: number;
  private readonly limiterHz: number;
  private readonly crackle: number;
  private readonly maxFc: number;

  private rng: () => number = () => 0;
  private layerRng: () => number = () => 0;
  private spare = 0;
  private hasSpare = false;
  private tRpm = 0;
  private tLoad = 0;
  private tWheel = 0;
  private rpm = 0;
  private load = 0;
  private wSpeed = 0;
  boost = 0;
  private whinePhase = 0;
  private limPhase = 0;
  private cutNow = false;
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
  private ticks = 0;
  private trRng: () => number = () => 0;
  private sinceCtl = 0;
  private lastThr = 0;
  private lastTrig = -1e15;
  private refSq = 0;
  private hissOn = false;
  private hissBpv = false;
  private hissT = 0;
  private hissAtt = 0;
  private hissK = 0;
  private hissDec = 0;
  private hissEnd = 0;
  private hissAmp = 0;
  private sinePh = 0;
  private readonly sineK: number;
  private flOn = false;
  private flT = 0;
  private flNext = 0;
  private flK = 0;
  private flN = 0;
  private flAmp = 0;
  private flTp = 1e9;
  private flDec = 0;
  private flSineDec = 0;
  private flAmpK = 0;
  private readonly flDecK: number;
  private readonly flSineK: number;
  private readonly chuffK: number;
  private sineEnv = 0;
  private flPh = 0;
  private flW = 0;
  private hw = 0;
  private pf = 0;
  private pm = 0;
  private chuffOn = false;
  private chuffEnv = 0;
  private chuffAmp = 0;
  private chuffT = 0;
  private liftTick = -1;
  private armedHigh = false;
  private lastPopTick = -1e15;
  private pops = 0;
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
    this.injMask =
      pow2AtLeast(Math.ceil((MAX_PULSE_S + MAX_RUNNER_S) * sampleRate) + 64) - 1;
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
    this.cylVar = spec.cylVar;
    this.exhaustGain = spec.exhaustGain;
    this.cylAmp = new Float64Array(this.cyl);
    this.cylOff = new Float64Array(this.cyl);
    this.cylRunner = new Float64Array(this.cyl);
    const maxFc = MAX_FC_FRAC * sampleRate;
    this.intakeGain = spec.intakeMix > 0 ? spec.intakeMix : 0;
    this.intakeCo = bpCo(Math.min(spec.intakeHz, maxFc), INTAKE_Q, sampleRate, 1);
    this.blockN = spec.block.length > 6 ? 6 : spec.block.length;
    this.blockCo = new Float64Array(this.blockN * 4);
    this.blockSt = new Float64Array(this.blockN * 4);
    for (let m = 0; m < this.blockN; m++) {
      const mode = spec.block[m];
      this.blockCo.set(
        bpCo(Math.min(mode.hz, maxFc), mode.q, sampleRate, Math.pow(10, mode.gainDb / 20)),
        m * 4,
      );
    }
    this.lpOn = spec.lowpassHz < LP_MAX_HZ;
    this.lpCo = lpCo(Math.min(spec.lowpassHz, maxFc), BUTTER_Q, sampleRate);
    this.turboStage = spec.turbo !== null;
    this.shelfOn = spec.bassDb !== 0;
    this.shelfCo = lsCo(BASS_HZ, spec.bassDb, sampleRate);
    const turbo = spec.turbo;
    const lagS = turbo ? turbo.lagS : 0;
    this.turboGain = turbo && turbo.gain > 0 ? turbo.gain : 0;
    this.turboCenter = turbo ? turbo.centerHz : 0;
    this.turboSpan = turbo ? turbo.spanHz : 0;
    this.turboLag0 = lagS <= 0;
    this.aBoost = lagS > 0 ? 1 - Math.exp(-1 / (lagS * sampleRate)) : 0;
    const downLagS = turbo && turbo.downLagS !== undefined ? turbo.downLagS : lagS;
    this.downLag0 = downLagS <= 0;
    this.aDown = downLagS > 0 ? 1 - Math.exp(-1 / (downLagS * sampleRate)) : 0;
    const vk = turbo?.valve;
    this.valve = vk === 'bov' ? 2 : vk === 'bpv' ? 1 : 0;
    this.flutterAmt = turbo?.flutter ?? 0;
    this.wgAmt = turbo && turbo.wastegateKind === 'external' ? (turbo.wastegate ?? 0) : 0;
    this.hasTrans = this.valve > 0 || this.flutterAmt > 0 || this.wgAmt > 0;
    this.aRef = 1 - Math.exp(-1 / (REF_TAU_S * sampleRate));
    this.flDecK = Math.exp(-1 / (0.03 * sampleRate));
    this.flSineK = Math.exp(-1 / (0.02 * sampleRate));
    this.chuffK = Math.exp(-1 / (0.08 * sampleRate));
    this.sineK = Math.exp(-1 / (0.04 * sampleRate));
    this.dHw = 1 / (WG_RAMP_S * sampleRate);
    this.flCo = bpCo(Math.min(2000, maxFc), 2, sampleRate, 1);
    this.wgCo = bpCo(Math.min(3000, maxFc), 1, sampleRate, 1);
    this.whineGain = spec.whine && spec.whine.gain > 0 ? spec.whine.gain : 0;
    this.whineOrder = spec.whine ? spec.whine.order : 0;
    this.whineWheel = !!spec.whine && spec.whine.source === 'wheel';
    this.whineMin = spec.whine ? spec.whine.minSpeedMs : 0;
    this.limiterHz = spec.limiterHz;
    this.crackle = spec.crackle > 0 ? spec.crackle : 0;
    this.maxFc = MAX_FC_FRAC * sampleRate;
    this.reset();
  }

  get popCount(): number {
    return this.pops;
  }

  setControl(c: VoiceControl): void {
    this.tRpm = Number.isFinite(c.rpm) && c.rpm > 0 ? c.rpm : 0;
    const l = Number.isFinite(c.load) ? c.load : 0;
    this.tLoad = l < 0 ? 0 : l > 1 ? 1 : l;
    const t = Number.isFinite(c.throttle) ? c.throttle : 0;
    this.throttle = t < 0 ? 0 : t > 1 ? 1 : t;
    const w = Number.isFinite(c.wheelSpeedMs) ? c.wheelSpeedMs : 0;
    this.wheelSpeedMs = w < 0 ? 0 : w;
    this.tWheel = this.wheelSpeedMs;
    this.limiter = c.limiter;
    if (this.hasTrans && Number.isFinite(c.throttle)) {
      const rate = (this.lastThr - this.throttle) / Math.min(this.sinceCtl / this.fs, TRIG_MAX_DT_S);
      if (
        this.sinceCtl > 0 &&
        rate > TRIG_RATE &&
        this.boost > TRIG_BOOST &&
        this.ticks - this.lastTrig >= TRIG_REFRACTORY_S * this.fs
      ) {
        this.lastTrig = this.ticks;
        this.trigger(this.boost);
      }
    }
    this.lastThr = this.throttle;
    this.sinceCtl = 0;
  }

  private trigger(s: number): void {
    const fs = this.fs;
    const ref = Math.sqrt(this.refSq);
    if (this.valve > 0) {
      const bpv = this.valve === 1;
      this.hissBpv = bpv;
      this.hissT = 0;
      this.hissOn = true;
      this.hsSt1.fill(0);
      this.hsSt2.fill(0);
      if (bpv) {
        this.hsCo1.set(bpCo(1800, 6, fs, 1));
        this.hissAtt = 0.008;
        this.hissK = Math.exp(-1 / (0.06 * fs));
        this.hissEnd = 0.3;
        this.hissAmp = ref * BPV_GAIN * s;
        this.sineEnv = 1;
        this.sinePh = 0;
      } else {
        const dur = 0.25 + 0.5 * s;
        this.hsCo1.set(bpCo(3500 + 2000 * s, 1.5, fs, 1));
        this.hsCo2.set(bpCo(7000, 1.5, fs, 1));
        this.hissAtt = 0.005;
        this.hissK = Math.exp(-3 / (dur * fs));
        this.hissEnd = 1.5 * dur;
        this.hissAmp = ref * BOV_GAIN * Math.pow(s, 1.5);
      }
      this.hissDec = 1;
    }
    const n = Math.round((4 + 4 * s) * this.flutterAmt);
    if (n >= 1) {
      this.flOn = true;
      this.flT = 0;
      this.flNext = FLUTTER_DELAY_S;
      this.flK = 0;
      this.flN = n;
      this.flAmp = ref * FLUTTER_GAIN * s;
      this.flTp = 1e9;
      this.flSt.fill(0);
    }
    if (this.wgAmt > 0) {
      this.chuffOn = true;
      this.chuffT = 0;
      this.chuffEnv = 1;
      this.chuffAmp = ref * WG_CHUFF * this.wgAmt;
    }
  }

  reset(): void {
    this.rng = mulberry32(this.seed);
    this.layerRng = mulberry32(this.seed + 1);
    this.trRng = mulberry32(this.seed + 7);
    this.sinceCtl = 0;
    this.lastThr = 0;
    this.lastTrig = -1e15;
    this.refSq = 0;
    this.hissOn = false;
    this.flOn = false;
    this.flTp = 1e9;
    this.hw = 0;
    this.pf = 0;
    this.pm = 0;
    this.chuffOn = false;
    this.flSt.fill(0);
    this.wgSt.fill(0);
    this.hsSt1.fill(0);
    this.hsSt2.fill(0);
    this.hasSpare = false;
    this.spare = 0;
    this.tRpm = 0;
    this.tLoad = 0;
    this.tWheel = 0;
    this.rpm = 0;
    this.load = 0;
    this.wSpeed = 0;
    this.boost = 0;
    this.whinePhase = 0;
    this.limPhase = 0;
    this.cutNow = false;
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
    this.ticks = 0;
    this.liftTick = -1;
    this.armedHigh = false;
    this.lastPopTick = -1e15;
    this.pops = 0;
    this.lpState.fill(0);
    this.lpSt.fill(0);
    this.lp2St.fill(0);
    this.shelfSt.fill(0);
    this.intakeSt.fill(0);
    this.blockSt.fill(0);
    this.turboSt.fill(0);
    this.inj[0].fill(0);
    this.inj[1].fill(0);
    for (let i = 0; i < 3; i++) this.tube[i].fill(0);
    this.drawTraits();
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

  private drawTraits(): void {
    const r = mulberry32(this.seed * 7919 + 13);
    const cv = this.cylVar;
    for (let i = 0; i < this.cyl; i++) {
      this.cylAmp[i] = 1 + cv * (2 * r() - 1);
      this.cylOff[i] = 7 * cv * (2 * r() - 1);
      const rr = r();
      // cylVar 0 means identical cylinders: the runner keeps its neutral mid draw.
      this.cylRunner[i] = ((2 * (0.35 + 0.25 * (cv > 0 ? rr : 0.5))) / 480) * this.fs;
    }
  }

  private redrawJitter(): void {
    for (let i = 0; i < this.cyl; i++) {
      let f = this.firing[i] + this.cylOff[i];
      if (this.jitterDeg > 0) f += this.jitterDeg * this.gauss();
      this.eff[i] = f < 0 ? 0 : f > 719.999 ? 719.999 : f;
    }
  }

  private fire(i: number, frac: number): void {
    if (this.cutNow) return;
    const a =
      this.cylAmp[i] *
      (0.25 + 0.75 * this.load) *
      (1 + (this.jitterAmp > 0 ? this.jitterAmp * this.gauss() : 0));
    let widthS = this.pulseDeg / (6 * this.rpm);
    widthS = widthS < MIN_PULSE_S ? MIN_PULSE_S : widthS > MAX_PULSE_S ? MAX_PULSE_S : widthS;
    const w = widthS * this.fs;
    const amp = a * w * PULSE_SCALE;
    const buf = this.inj[this.bankOf[i]];
    const mask = this.injMask;
    const scale = KERNEL_N / w;
    const run = this.cylRunner[i];
    let pos = (1 - frac) * scale;
    for (let m = 0; pos < KERNEL_N; m++, pos += scale) {
      const k = Math.floor(pos);
      const t = pos - k;
      const v = PULSE_KERNEL[k] + t * (PULSE_KERNEL[k + 1] - PULSE_KERNEL[k]);
      buf[(this.head + m) & mask] += amp * v;
      const pd = run + m;
      const pi = Math.floor(pd);
      const pf = pd - pi;
      buf[(this.head + pi) & mask] += RUNNER_GAIN * (1 - pf) * amp * v;
      buf[(this.head + pi + 1) & mask] += RUNNER_GAIN * pf * amp * v;
    }
    this.maybePop();
  }

  private maybePop(): void {
    if (this.crackle <= 0 || this.throttle >= CRACKLE_THR || this.rpm <= POP_RPM) return;
    if (this.liftTick < 0) return;
    const since = (this.ticks - this.liftTick) / this.fs;
    if (since < POP_MIN_S || since > POP_MAX_S) return;
    if ((this.ticks - this.lastPopTick) / this.fs < POP_GAP_S) return;
    const firesPerS = (this.cyl * this.rpm) / 120;
    const rate = CRACKLE_RATE * this.crackle * Math.min(1, this.rpm / 8000) * Math.exp(-since / 0.8);
    if (this.rng() >= rate / firesPerS) return;
    this.injectPop(POP_AMP * (0.6 + 0.8 * this.rng()), 0.0036 + 0.0054 * this.rng());
    this.pops++;
    this.lastPopTick = this.ticks;
  }

  private injectPop(amp: number, widthS: number): void {
    const w = widthS * this.fs;
    const scale = KERNEL_N / w;
    const mask = this.injMask;
    const a = amp * w * PULSE_SCALE;
    for (let b = 0; b < 2; b++) {
      const buf = this.inj[b];
      let pos = 0;
      for (let m = 0; pos < KERNEL_N; m++, pos += scale) {
        const k = Math.floor(pos);
        const t = pos - k;
        buf[(this.head + m) & mask] +=
          a * (PULSE_KERNEL[k] + t * (PULSE_KERNEL[k + 1] - PULSE_KERNEL[k]));
      }
    }
  }

  private intakeStep(): number {
    const angle = this.angle;
    let gate = 0;
    for (let i = 0; i < this.cyl; i++) {
      let d = angle - this.firing[i] - 360;
      d -= Math.floor(d / CYCLE_DEG) * CYCLE_DEG;
      if (d >= INTAKE_WINDOW_DEG) continue;
      if (d < INTAKE_EDGE_DEG) gate += 0.5 - 0.5 * Math.cos((Math.PI * d) / INTAKE_EDGE_DEG);
      else if (d >= INTAKE_WINDOW_DEG - INTAKE_EDGE_DEG) {
        gate += 0.5 + 0.5 * Math.cos((Math.PI * (d - INTAKE_WINDOW_DEG + INTAKE_EDGE_DEG)) / INTAKE_EDGE_DEG);
      } else gate += 1;
    }
    if (gate <= 0) return 0;
    const x = (this.layerRng() * 2 - 1) * gate;
    const y = biquad(this.intakeCo, 0, this.intakeSt, 0, x);
    return y * (this.intakeGain * this.throttle) * INTAKE_AMP;
  }

  private blockStep(x: number): number {
    let acc = 0;
    for (let m = 0; m < this.blockN; m++) {
      acc += biquad(this.blockCo, m * 4, this.blockSt, m * 4, x);
    }
    return acc;
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
    const maxFc = this.maxFc;
    const hasTurbo = this.turboGain > 0;
    const needBoost = hasTurbo || this.hasTrans;
    const hasWhine = this.whineGain > 0;
    const hasIntake = this.intakeGain > 0;
    const hasBlock = this.blockN > 0;
    for (let s = 0; s < n; s++) {
      this.rpm += (this.tRpm - this.rpm) * this.aRpm;
      this.load += (this.tLoad - this.load) * this.aLoad;
      this.wSpeed += (this.tWheel - this.wSpeed) * this.aRpm;
      if (needBoost) {
        const up = this.load >= this.boost;
        if (up ? this.turboLag0 : this.downLag0) this.boost = this.load;
        else this.boost += (this.load - this.boost) * (up ? this.aBoost : this.aDown);
      }
      if (this.limiter) {
        this.limPhase += this.limiterHz / fs;
        if (this.limPhase >= 1) this.limPhase -= 1;
        this.cutNow = this.limPhase >= 0.5;
      } else this.cutNow = false;

      if (this.throttle < CRACKLE_THR) {
        if (this.armedHigh) {
          this.armedHigh = false;
          this.liftTick = this.ticks;
        }
      } else if (this.throttle >= ARM_THR) this.armedHigh = true;

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

      let ex = this.lpOn ? bqStep(this.lpCo, this.lpSt, dc) : dc;
      if (hasBlock) ex += this.blockStep(x0 + x1);
      if (this.lpOn && this.turboStage) ex = bqStep(this.lpCo, this.lp2St, ex);
      if (this.shelfOn) ex = bqStep(this.shelfCo, this.shelfSt, ex);
      ex *= this.exhaustGain;

      // 2x oversampled clip; 3-tap half-band decimation with one sample of latency
      const mid = this.clip(0.5 * (this.clipPrev + ex));
      const cur = this.clip(ex);
      this.clipPrev = ex;
      const y = 0.5 * this.clipCurPrev + 0.25 * (this.clipMidPrev + mid);
      this.clipMidPrev = mid;
      this.clipCurPrev = cur;

      let extra = 0;
      if (hasIntake) extra += this.intakeStep();
      if (hasTurbo) {
        let fc = this.turboCenter + this.turboSpan * this.boost;
        if (fc > maxFc) fc = maxFc;
        else if (fc < 10) fc = 10;
        const w0 = (TWO_PI * fc) / fs;
        const alpha = Math.sin(w0) / (2 * TURBO_Q);
        const a0 = 1 + alpha;
        const b0 = alpha / a0;
        const a1 = (-2 * Math.cos(w0)) / a0;
        const a2 = (1 - alpha) / a0;
        const x = this.layerRng() * 2 - 1;
        const st = this.turboSt;
        const ty = b0 * (x - st[1]) - a1 * st[2] - a2 * st[3];
        st[1] = st[0];
        st[0] = x;
        st[3] = st[2];
        st[2] = ty;
        extra += ty * this.turboGain * this.boost * TURBO_AMP;
      }
      if (hasWhine) {
        let f = 0;
        let on = true;
        if (this.whineWheel) {
          if (this.wheelSpeedMs < this.whineMin) on = false;
          else f = (this.whineOrder * this.wSpeed) / (TWO_PI * WHEEL_RADIUS_M);
        } else f = (this.whineOrder * this.rpm) / 60;
        if (on && f >= 1) {
          if (f > maxFc) f = maxFc;
          this.whinePhase += (TWO_PI * f) / fs;
          if (this.whinePhase >= TWO_PI) this.whinePhase -= TWO_PI;
          extra += Math.sin(this.whinePhase) * this.whineGain;
        }
      }

      const o = y - this.dc2In1 + R * this.dc2Out1;
      this.dc2In1 = y;
      this.dc2Out1 = o;
      const v0 = (o + extra) * this.gain;
      out[s] = PEAK * Math.tanh((this.hasTrans ? v0 + this.transientStep(x0 + x1, v0) : v0) / PEAK);
      this.ticks++;
    }
    this.sinceCtl += n;
  }

  private transientStep(pulse: number, v0: number): number {
    const dt = 1 / this.fs;
    this.refSq += (v0 * v0 - this.refSq) * this.aRef;
    const wgOn = this.wgAmt > 0;
    if (wgOn) {
      const gate = this.tLoad > WG_GATE_LOAD && this.boost > 0.7;
      this.hw += gate ? this.dHw : -this.dHw;
      this.hw = this.hw < 0 ? 0 : this.hw > 1 ? 1 : this.hw;
      const a = Math.abs(pulse);
      this.pf = a > this.pf ? a : this.pf * 0.995;
      this.pm = a > this.pm ? a : this.pm * 0.99999;
    }
    const wgActive = wgOn && (this.hw > 0 || this.chuffOn);
    if (!this.hissOn && !this.flOn && !wgActive) return 0;
    const nz = this.trRng() * 2 - 1;
    let tr = 0;
    if (this.hissOn) {
      const u = this.hissT - HISS_DELAY_S;
      this.hissT += dt;
      if (u >= this.hissEnd) this.hissOn = false;
      else if (u >= 0) {
        const env = (u < this.hissAtt ? u / this.hissAtt : 1) * this.hissDec;
        this.hissDec *= this.hissK;
        let x: number;
        if (this.hissBpv) {
          x = biquad(this.hsCo1, 0, this.hsSt1, 0, nz) / N_BPV;
          this.sinePh += (TWO_PI * 600) / this.fs;
          x += 0.5 * Math.sin(this.sinePh) * this.sineEnv;
          this.sineEnv *= this.sineK;
        } else {
          x =
            (biquad(this.hsCo1, 0, this.hsSt1, 0, nz) +
              0.355 * biquad(this.hsCo2, 0, this.hsSt2, 0, nz)) /
            N_BOV;
        }
        tr += this.hissAmp * env * x;
      }
    }
    if (this.flOn) tr += this.flutterStep(nz, dt);
    if (wgActive) {
      const x = biquad(this.wgCo, 0, this.wgSt, 0, nz) / N_WG;
      const pe = this.pm > 1e-12 ? this.pf / this.pm : 0;
      const ref = Math.sqrt(this.refSq);
      let g = this.hw * WG_HOLD * this.wgAmt * ref * (0.6 + 0.4 * pe);
      if (this.chuffOn) {
        const att = this.chuffT < 0.003 ? this.chuffT / 0.003 : 1;
        g += this.chuffAmp * att * this.chuffEnv;
        this.chuffEnv *= this.chuffK;
        this.chuffT += dt;
        if (this.chuffT > 0.6) this.chuffOn = false;
      }
      tr += g * x;
    }
    return tr;
  }

  private flutterStep(nz: number, dt: number): number {
    const t = this.flT;
    this.flT += dt;
    if (this.flK < this.flN && t >= this.flNext) {
      const k = this.flK;
      this.flTp = 0;
      this.flPh = 0;
      this.flW = (TWO_PI * 250 * Math.pow(0.95, k)) / this.fs;
      this.flNext = t + 1 / (14 - (7 * k) / this.flN);
      this.flDec = 1;
      this.flSineDec = 1;
      this.flK = k + 1;
      this.flAmpK = k === 0 ? this.flAmp : this.flAmpK * 0.8;
    }
    if (this.flTp > 0.25) {
      if (this.flK >= this.flN) this.flOn = false;
      return 0;
    }
    const tp = this.flTp;
    this.flTp += dt;
    const att = tp < 0.004 ? tp / 0.004 : 1;
    this.flPh += this.flW;
    const x = biquad(this.flCo, 0, this.flSt, 0, nz) / N_FLUTTER + 0.5 * Math.sin(this.flPh) * this.flSineDec;
    const y = this.flAmpK * att * this.flDec * x;
    this.flDec *= this.flDecK;
    this.flSineDec *= this.flSineK;
    return y;
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

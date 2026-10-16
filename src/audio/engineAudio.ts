import { DEFAULT_CAR_SOUND, type CarSound } from '../physics/carSpec';
import { LIMITER_RPM } from '../physics/gearbox';
import type { Surface } from '../core/types';
import { crackleSchedule, kerbRumbleHz, shiftEnvelope, windGain } from './effects';
import { firingHz } from './engineSynth';
// Bundled as its own worker-style asset; addModule needs the URL string, not a URL object.
import engineWorkletUrl from './engineWorklet.ts?worker&url';

export interface EngineParams {
  frequencyHz: number;
  gain: number;
}

export interface EngineAudioStats {
  running: boolean;
  engine: 'worklet' | 'oscillator';
  firingHz: number;
}

/** Context plus the bus gains and engine filter the Mixer drives. */
export interface AudioMixNodes {
  ctx: AudioContext;
  master: GainNode;
  engine: GainNode;
  effects: GainNode;
  engineFilter: BiquadFilterNode;
}

const SMOOTHING = 0.05;
const SQUEAL_ON = 0.1;
const SQUEAL_FULL = 0.2;
const SQUEAL_MAX = 0.5;
const IDLE_RPM = 900;
const WORKLET_LEVEL = 0.5;
const WORKLET_SEED = 1;
const KERB_STRIPE_M = 1.5;
const KERB_GAIN = 0.3;
const KERB_BAND_HZ = 120;
const GRAVEL_GAIN = 0.35;
const GRAVEL_FULL_MS = 20;
const GRAVEL_LOWPASS_HZ = 500;
const WIND_LOWPASS_HZ = 1200;
const SHIFT_LEN_S = 0.08;
const CRACKLE_GAIN = 0.4;
const CRACKLE_ATTACK_S = 0.004;
const CRACKLE_DECAY_S = 0.05;
const CRACKLE_BAND_HZ = 2000;
const MIX_BYPASS_HZ = 22050;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

interface EffectNodes {
  windNoise: AudioBufferSourceNode;
  windFilter: BiquadFilterNode;
  windGain: GainNode;
  kerbNoise: AudioBufferSourceNode;
  kerbFilter: BiquadFilterNode;
  kerbAmp: GainNode;
  kerbLfo: OscillatorNode;
  kerbDepth: GainNode;
  gravelNoise: AudioBufferSourceNode;
  gravelFilter: BiquadFilterNode;
  gravelGain: GainNode;
  crackleFilter: BiquadFilterNode;
  crackleBus: GainNode;
}

export function engineParams(rpm: number, throttle: number): EngineParams {
  return {
    frequencyHz: (Math.max(0, rpm) / 60) * 2,
    gain: 0.15 + 0.45 * clamp(throttle, 0, 1),
  };
}

export function tyreSquealGain(slipRatios: readonly number[]): number {
  let count = 0;
  let maxSlip = 0;
  for (const slip of slipRatios) {
    if (slip > SQUEAL_ON) count++;
    if (slip > maxSlip) maxSlip = slip;
  }
  if (count === 0 || slipRatios.length === 0) return 0;
  const ramp = clamp((maxSlip - SQUEAL_ON) / (SQUEAL_FULL - SQUEAL_ON), 0, 1);
  return SQUEAL_MAX * ramp * (count / slipRatios.length);
}

export class EngineAudio {
  private readonly ctx: AudioContext;
  private readonly engineGain: GainNode;
  private readonly subGain: GainNode;
  private readonly squealGain: GainNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly oscEngine: OscillatorNode;
  private readonly oscSub: OscillatorNode;
  private readonly squealNoise: AudioBufferSourceNode;
  private readonly squealFilter: BiquadFilterNode;
  private masterVolume = 0.5;
  private engineBase = 0.15;
  private subBase = 0.075;
  private squealBase = 0;
  private running = false;
  private disposed = false;
  private pausedValue = false;
  private sound: CarSound;
  private workletNode: AudioWorkletNode | null = null;
  private workletGain: GainNode | null = null;
  private moduleState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private lastRpm = 0;
  private lastThrottle = 0;
  private limiterRpm = LIMITER_RPM;
  private windBase = 0;
  private kerbBase = 0;
  private gravelBase = 0;
  private shiftActive = false;
  private shiftStart = 0;
  private prevShifting = false;
  private noiseBuffer: AudioBuffer | null = null;
  private effectNodes: EffectNodes | null = null;
  private readonly scheduledCrackle = new Set<AudioBufferSourceNode>();
  private mix: Omit<AudioMixNodes, 'ctx'> | null = null;

  constructor(
    createContext: () => AudioContext = () => new AudioContext(),
    sound: CarSound = DEFAULT_CAR_SOUND,
  ) {
    this.ctx = createContext();
    this.sound = sound;
    const now = this.ctx.currentTime;

    this.lowpass = this.ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.setValueAtTime(800, now);
    this.lowpass.Q.setValueAtTime(0.7, now);

    this.engineGain = this.ctx.createGain();
    this.subGain = this.ctx.createGain();
    this.squealGain = this.ctx.createGain();

    this.oscEngine = this.ctx.createOscillator();
    this.oscEngine.type = 'sawtooth';
    this.oscSub = this.ctx.createOscillator();
    this.oscSub.type = 'sawtooth';
    const idle = engineParams(IDLE_RPM, 0).frequencyHz;
    this.oscEngine.frequency.setValueAtTime(idle, now);
    this.oscSub.frequency.setValueAtTime(idle * 2, now);

    this.squealFilter = this.ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.setValueAtTime(2400, now);
    this.squealFilter.Q.setValueAtTime(6, now);
    this.squealNoise = this.createNoiseSource();

    this.oscEngine.connect(this.engineGain);
    this.oscSub.connect(this.subGain);
    this.engineGain.connect(this.lowpass);
    this.subGain.connect(this.lowpass);
    this.lowpass.connect(this.ctx.destination);
    this.squealNoise.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.ctx.destination);

    this.applyGains();
    this.initWorklet();
  }

  setSound(sound: CarSound): void {
    if (this.disposed) return;
    this.sound = sound;
    if (this.moduleState === 'ready') this.rebuildWorklet();
  }

  getStats(): EngineAudioStats {
    return {
      running: this.running,
      engine: this.workletNode !== null ? 'worklet' : 'oscillator',
      firingHz: firingHz(this.lastRpm, this.sound.cylinders),
    };
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      this.oscEngine.start();
    } catch {
      /* already started */
    }
    try {
      this.oscSub.start();
    } catch {
      /* already started */
    }
    try {
      this.squealNoise.start();
    } catch {
      /* already started */
    }
  }

  resume(): void {
    if (this.disposed) return;
    this.start();
    if (this.pausedValue) return;
    try {
      this.ctx.resume().catch(() => {
        /* stays suspended until a user gesture */
      });
    } catch {
      /* context refuses to resume outside a gesture */
    }
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  setPaused(paused: boolean): void {
    if (this.disposed || paused === this.pausedValue) return;
    this.pausedValue = paused;
    try {
      if (paused) {
        this.ctx.suspend().catch(() => {
          /* context refuses to suspend */
        });
      } else {
        this.ctx.resume().catch(() => {
          /* stays suspended until a user gesture */
        });
      }
    } catch {
      /* context refuses the state change */
    }
  }

  update(rpm: number, throttle: number, slipRatios: readonly number[]): void {
    if (this.disposed) return;
    const offsets = crackleSchedule(this.lastThrottle, throttle, rpm, this.limiterRpm, this.sound.crackle, Math.random);
    if (offsets.length > 0) this.scheduleCrackle(offsets);
    this.lastRpm = rpm;
    this.lastThrottle = throttle;
    const { frequencyHz, gain } = engineParams(rpm, throttle);
    this.squealBase = tyreSquealGain(slipRatios);
    if (this.workletNode) {
      this.engineBase = 0;
      this.subBase = 0;
      try {
        this.workletNode.port.postMessage({ rpm, throttle });
      } catch {
        /* port already closed */
      }
    } else if (this.moduleState === 'loading') {
      // While addModule is pending the engine stays silent instead of doubling paths.
      this.engineBase = 0;
      this.subBase = 0;
    } else {
      this.engineBase = gain;
      this.subBase = gain / 2;
      const now = this.ctx.currentTime;
      this.oscEngine.frequency.setTargetAtTime(frequencyHz, now, SMOOTHING);
      this.oscSub.frequency.setTargetAtTime(frequencyHz * 2, now, SMOOTHING);
      this.lowpass.frequency.setTargetAtTime(clamp(400 + frequencyHz * 4, 400, 6000), now, SMOOTHING);
    }
    this.applyGains();
  }

  setLimiterRpm(rpm: number): void {
    if (Number.isFinite(rpm) && rpm > 0) this.limiterRpm = rpm;
  }

  updateEffects(s: { speed: number; surface: Surface; shifting: boolean; slipRatios: readonly number[] }): void {
    if (this.disposed) return;
    if (!this.effectNodes) this.initEffects();
    const now = this.ctx.currentTime;
    if (s.shifting && !this.prevShifting) {
      this.shiftActive = true;
      this.shiftStart = now;
    }
    this.prevShifting = s.shifting;
    this.windBase = windGain(s.speed);
    const onKerb = s.surface === 'kerb';
    this.kerbBase = onKerb ? KERB_GAIN : 0;
    if (onKerb) {
      this.effectNodes?.kerbLfo.frequency.setTargetAtTime(
        kerbRumbleHz(Math.abs(s.speed), KERB_STRIPE_M),
        now,
        SMOOTHING,
      );
    }
    this.gravelBase = s.surface === 'gravel' ? GRAVEL_GAIN * Math.min(1, Math.abs(s.speed) / GRAVEL_FULL_MS) : 0;
    this.squealBase = tyreSquealGain(s.slipRatios);
    this.applyGains();
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1);
    if (!this.disposed) this.applyGains();
  }

  /** Builds the mixer bus once and re-routes engine and effects through it; earlier connections are replaced. */
  mixerNodes(): AudioMixNodes {
    if (!this.mix) {
      const now = this.ctx.currentTime;
      const master = this.ctx.createGain();
      const engine = this.ctx.createGain();
      const effects = this.ctx.createGain();
      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.setValueAtTime(MIX_BYPASS_HZ, now);
      engineFilter.Q.setValueAtTime(0.7, now);
      engineFilter.connect(engine);
      engine.connect(master);
      effects.connect(master);
      master.connect(this.ctx.destination);
      this.lowpass.disconnect();
      this.lowpass.connect(engineFilter);
      this.squealGain.disconnect();
      this.squealGain.connect(effects);
      if (this.workletGain) {
        this.workletGain.disconnect();
        this.workletGain.connect(engineFilter);
      }
      const fx = this.effectNodes;
      if (fx) {
        for (const node of [fx.windGain, fx.kerbAmp, fx.gravelGain, fx.crackleBus]) {
          node.disconnect();
          node.connect(effects);
        }
      }
      this.mix = { master, engine, effects, engineFilter };
    }
    return { ctx: this.ctx, ...this.mix };
  }

  private engineSink(): AudioNode {
    return this.mix?.engineFilter ?? this.ctx.destination;
  }

  private effectsSink(): AudioNode {
    return this.mix?.effects ?? this.ctx.destination;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    for (const src of this.scheduledCrackle) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.scheduledCrackle.clear();
    this.disposeEffects();
    this.disconnectWorklet();
    for (const node of [this.oscEngine, this.oscSub, this.squealNoise]) {
      try {
        node.stop();
      } catch {
        /* never started */
      }
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    for (const node of [this.engineGain, this.subGain, this.squealGain, this.lowpass, this.squealFilter]) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    if (this.mix) {
      for (const node of [this.mix.master, this.mix.engine, this.mix.effects, this.mix.engineFilter]) {
        try {
          node.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }
    try {
      this.ctx.close().catch(() => {
        /* context already closed */
      });
    } catch {
      /* context already closed */
    }
  }

  private applyGains(): void {
    const now = this.ctx.currentTime;
    const m = this.masterVolume;
    const env = this.shiftGainEnv(now);
    this.engineGain.gain.setTargetAtTime(this.engineBase * m * env, now, SMOOTHING);
    this.subGain.gain.setTargetAtTime(this.subBase * m * env, now, SMOOTHING);
    this.squealGain.gain.setTargetAtTime(this.squealBase * m, now, SMOOTHING);
    this.workletGain?.gain.setTargetAtTime(WORKLET_LEVEL * m * env, now, SMOOTHING);
    const fx = this.effectNodes;
    if (fx) {
      fx.windGain.gain.setTargetAtTime(this.windBase * m, now, SMOOTHING);
      // Base + LFO depth pulse the kerb noise between 0 and the peak gain at the rumble rate.
      fx.kerbAmp.gain.setTargetAtTime(this.kerbBase * 0.5 * m, now, SMOOTHING);
      fx.kerbDepth.gain.setTargetAtTime(this.kerbBase * 0.5 * m, now, SMOOTHING);
      fx.gravelGain.gain.setTargetAtTime(this.gravelBase * m, now, SMOOTHING);
      fx.crackleBus.gain.setTargetAtTime(m, now, SMOOTHING);
    }
  }

  private shiftGainEnv(now: number): number {
    if (!this.shiftActive) return 1;
    const t = now - this.shiftStart;
    if (t >= SHIFT_LEN_S) {
      this.shiftActive = false;
      return 1;
    }
    return shiftEnvelope(t);
  }

  private initEffects(): void {
    if (this.disposed || this.effectNodes) return;
    const now = this.ctx.currentTime;

    const windNoise = this.createNoiseSource();
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(WIND_LOWPASS_HZ, now);
    windFilter.Q.setValueAtTime(0.7, now);
    const windGainNode = this.ctx.createGain();
    windNoise.connect(windFilter);
    windFilter.connect(windGainNode);
    windGainNode.connect(this.effectsSink());

    const kerbNoise = this.createNoiseSource();
    const kerbFilter = this.ctx.createBiquadFilter();
    kerbFilter.type = 'bandpass';
    kerbFilter.frequency.setValueAtTime(KERB_BAND_HZ, now);
    kerbFilter.Q.setValueAtTime(0.9, now);
    const kerbAmp = this.ctx.createGain();
    const kerbLfo = this.ctx.createOscillator();
    kerbLfo.type = 'sine';
    kerbLfo.frequency.setValueAtTime(0, now);
    const kerbDepth = this.ctx.createGain();
    kerbLfo.connect(kerbDepth);
    kerbDepth.connect(kerbAmp.gain);
    kerbNoise.connect(kerbFilter);
    kerbFilter.connect(kerbAmp);
    kerbAmp.connect(this.effectsSink());

    const gravelNoise = this.createNoiseSource();
    const gravelFilter = this.ctx.createBiquadFilter();
    gravelFilter.type = 'lowpass';
    gravelFilter.frequency.setValueAtTime(GRAVEL_LOWPASS_HZ, now);
    gravelFilter.Q.setValueAtTime(0.7, now);
    const gravelGainNode = this.ctx.createGain();
    gravelNoise.connect(gravelFilter);
    gravelFilter.connect(gravelGainNode);
    gravelGainNode.connect(this.effectsSink());

    const crackleFilter = this.ctx.createBiquadFilter();
    crackleFilter.type = 'bandpass';
    crackleFilter.frequency.setValueAtTime(CRACKLE_BAND_HZ, now);
    crackleFilter.Q.setValueAtTime(1, now);
    const crackleBus = this.ctx.createGain();
    crackleFilter.connect(crackleBus);
    crackleBus.connect(this.effectsSink());

    for (const src of [windNoise, kerbNoise, gravelNoise, kerbLfo]) {
      try {
        src.start();
      } catch {
        /* already started */
      }
    }

    this.effectNodes = {
      windNoise,
      windFilter,
      windGain: windGainNode,
      kerbNoise,
      kerbFilter,
      kerbAmp,
      kerbLfo,
      kerbDepth,
      gravelNoise,
      gravelFilter,
      gravelGain: gravelGainNode,
      crackleFilter,
      crackleBus,
    };
    this.applyGains();
  }

  private disposeEffects(): void {
    const fx = this.effectNodes;
    if (!fx) return;
    this.effectNodes = null;
    for (const src of [fx.windNoise, fx.kerbNoise, fx.gravelNoise, fx.kerbLfo]) {
      try {
        src.stop();
      } catch {
        /* never started */
      }
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    for (const node of [fx.windFilter, fx.windGain, fx.kerbFilter, fx.kerbAmp, fx.kerbDepth, fx.gravelFilter, fx.gravelGain, fx.crackleFilter, fx.crackleBus]) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }

  private scheduleCrackle(offsets: readonly number[]): void {
    const fx = this.effectNodes;
    if (!fx || !this.running) return;
    const now = this.ctx.currentTime;
    for (const offset of offsets) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.ensureNoiseBuffer();
      const g = this.ctx.createGain();
      const t0 = now + offset;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(CRACKLE_GAIN, t0 + CRACKLE_ATTACK_S);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + CRACKLE_ATTACK_S + CRACKLE_DECAY_S);
      src.connect(g);
      g.connect(fx.crackleFilter);
      this.scheduledCrackle.add(src);
      src.onended = () => {
        this.scheduledCrackle.delete(src);
        try {
          src.disconnect();
        } catch {
          /* already disconnected */
        }
        try {
          g.disconnect();
        } catch {
          /* already disconnected */
        }
      };
      try {
        src.start(t0);
        src.stop(t0 + CRACKLE_ATTACK_S + CRACKLE_DECAY_S);
      } catch {
        /* context rejects scheduling */
      }
    }
  }

  private initWorklet(): void {
    if (this.disposed) return;
    let worklet: AudioWorklet | undefined;
    try {
      worklet = this.ctx.audioWorklet;
    } catch {
      return;
    }
    if (!worklet || typeof worklet.addModule !== 'function') return;
    this.moduleState = 'loading';
    let module: Promise<void>;
    try {
      module = worklet.addModule(engineWorkletUrl);
    } catch {
      this.moduleState = 'failed';
      return;
    }
    module
      .then(() => {
        if (this.disposed) return;
        this.moduleState = 'ready';
        this.rebuildWorklet();
      })
      .catch(() => {
        this.moduleState = 'failed';
        if (this.disposed) return;
        const { gain } = engineParams(this.lastRpm, this.lastThrottle);
        this.engineBase = gain;
        this.subBase = gain / 2;
        this.applyGains();
      });
  }

  private rebuildWorklet(): void {
    if (this.disposed || this.moduleState !== 'ready') return;
    this.disconnectWorklet();
    try {
      const node = new AudioWorkletNode(this.ctx, 'engine-synth', {
        numberOfInputs: 0,
        outputChannelCount: [1],
        processorOptions: {
          cylinders: this.sound.cylinders,
          exhaustLengthM: this.sound.exhaustLengthM,
          intakeMix: this.sound.intakeMix,
          seed: WORKLET_SEED,
        },
      });
      const gain = this.ctx.createGain();
      node.connect(gain);
      gain.connect(this.engineSink());
      this.workletNode = node;
      this.workletGain = gain;
    } catch {
      this.moduleState = 'failed';
      this.disconnectWorklet();
      return;
    }
    try {
      this.workletNode?.port.postMessage({ rpm: this.lastRpm, throttle: this.lastThrottle });
    } catch {
      /* node without a port still renders */
    }
    this.applyGains();
  }

  private disconnectWorklet(): void {
    if (this.workletNode) {
      try {
        this.workletNode.port.close();
      } catch {
        /* port already closed */
      }
      try {
        this.workletNode.disconnect();
      } catch {
        /* already disconnected */
      }
      this.workletNode = null;
    }
    if (this.workletGain) {
      try {
        this.workletGain.disconnect();
      } catch {
        /* already disconnected */
      }
      this.workletGain = null;
    }
  }

  private createNoiseSource(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.ensureNoiseBuffer();
    source.loop = true;
    return source;
  }

  private ensureNoiseBuffer(): AudioBuffer {
    if (!this.noiseBuffer) {
      const rate = this.ctx.sampleRate;
      const buffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(rate)), rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }
}

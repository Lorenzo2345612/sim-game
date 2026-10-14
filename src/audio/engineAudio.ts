export interface EngineParams {
  frequencyHz: number;
  gain: number;
}

const SMOOTHING = 0.05;
const SQUEAL_ON = 0.1;
const SQUEAL_FULL = 0.2;
const SQUEAL_MAX = 0.5;
const IDLE_RPM = 900;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

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

  constructor(createContext: () => AudioContext = () => new AudioContext()) {
    this.ctx = createContext();
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
    const { frequencyHz, gain } = engineParams(rpm, throttle);
    this.engineBase = gain;
    this.subBase = gain / 2;
    this.squealBase = tyreSquealGain(slipRatios);
    const now = this.ctx.currentTime;
    this.oscEngine.frequency.setTargetAtTime(frequencyHz, now, SMOOTHING);
    this.oscSub.frequency.setTargetAtTime(frequencyHz * 2, now, SMOOTHING);
    this.lowpass.frequency.setTargetAtTime(clamp(400 + frequencyHz * 4, 400, 6000), now, SMOOTHING);
    this.applyGains();
  }

  setMasterVolume(v: number): void {
    this.masterVolume = clamp(v, 0, 1);
    if (!this.disposed) this.applyGains();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
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
    this.engineGain.gain.setTargetAtTime(this.engineBase * m, now, SMOOTHING);
    this.subGain.gain.setTargetAtTime(this.subBase * m, now, SMOOTHING);
    this.squealGain.gain.setTargetAtTime(this.squealBase * m, now, SMOOTHING);
  }

  private createNoiseSource(): AudioBufferSourceNode {
    const rate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(rate)), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }
}

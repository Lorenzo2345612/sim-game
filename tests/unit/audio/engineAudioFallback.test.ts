import { describe, it, expect, afterEach } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';
import type { CarSound } from '../../../src/physics/carSpec';
import { legacySynthSpec } from '../../../src/audio/soundSpec';

class FakeParam {
  value: number;
  targets: number[] = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): FakeParam {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number): FakeParam {
    this.value = v;
    this.targets.push(v);
    return this;
  }
  cancelScheduledValues(): FakeParam {
    return this;
  }
}

type FakeNode<T> = T & { connect(target: unknown): unknown; disconnect(): void };

function node<T extends object>(extra: T): FakeNode<T> {
  return {
    ...extra,
    connect(target: unknown) {
      return target;
    },
    disconnect() {
      /* mock */
    },
  };
}

class FakeContext {
  gains: Array<{ gain: FakeParam }> = [];
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = node({});
  audioWorklet: { addModule(url: URL): Promise<void> } | undefined;

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  createOscillator() {
    return node({
      type: 'sine' as const,
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null,
      start() {
        /* mock */
      },
      stop() {
        /* mock */
      },
    });
  }
  createGain() {
    const g = node({ gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createBiquadFilter() {
    return node({
      type: 'lowpass' as const,
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      gain: new FakeParam(0),
      detune: new FakeParam(0),
    });
  }
  createBuffer(channels: number, length: number, rate: number) {
    return {
      numberOfChannels: channels,
      length,
      duration: length / rate,
      sampleRate: rate,
      getChannelData() {
        return new Float32Array(length);
      },
    };
  }
  createBufferSource() {
    return node({
      buffer: null,
      loop: false,
      playbackRate: new FakeParam(1),
      onended: null,
      start() {
        /* mock */
      },
      stop() {
        /* mock */
      },
    });
  }
}

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  messages: Array<{ rpm: number; throttle: number }> = [];
  disconnected = 0;
  port = {
    postMessage: (msg: { rpm: number; throttle: number }): void => {
      this.messages.push(msg);
    },
    close() {
      /* mock */
    },
  };
  constructor(
    _ctx: unknown,
    public name: string,
    public options: { processorOptions?: { cylinders?: number } },
  ) {
    FakeWorkletNode.instances.push(this);
  }
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {
    this.disconnected++;
  }
}

const flush = async (turns = 4): Promise<void> => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};

const SOUND: CarSound = {
  cylinders: 8,
  exhaustLengthM: 1.5,
  intakeMix: 0.4,
  crackle: 0.1,
  synth: legacySynthSpec({ cylinders: 8, exhaustLengthM: 1.5, intakeMix: 0.4, crackle: 0.1 }),
};

afterEach(() => {
  delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  FakeWorkletNode.instances = [];
});

describe('109 engine worklet fallback', () => {
  it('context without audioWorklet keeps the oscillator path and never throws', () => {
    const ctx = new FakeContext();
    const audio = new EngineAudio(() => ctx as unknown as AudioContext, SOUND);
    expect(() => audio.update(6000, 0.5, [0.2, 0, 0, 0])).not.toThrow();
    const stats = audio.getStats();
    expect(stats.engine).toBe('oscillator');
    expect(stats.running).toBe(false);
    expect(stats.firingHz).toBeCloseTo((6000 * 8) / 120, 6);
    audio.start();
    expect(audio.getStats().running).toBe(true);
  });

  it('update while addModule is pending stays silent and only stores values', async () => {
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => new Promise<void>(() => {}) };
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    audio.update(3000, 1, [0, 0, 0, 0]);
    await flush();
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(ctx.gains[1].gain.value).toBe(0);
    expect(audio.getStats().firingHz).toBeCloseTo((3000 * 4) / 120, 6);
  });

  it('a rejected addModule falls back to the oscillators', async () => {
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.reject(new Error('no worklet')) };
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    audio.update(3000, 1, [0, 0, 0, 0]);
    await flush();
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.gains[0].gain.value).toBeGreaterThan(0);
  });

  it('a resolved addModule drives the worklet node and keeps tyre squeal', async () => {
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeWorkletNode;
    const ctx = new FakeContext();
    let moduleUrl: unknown;
    ctx.audioWorklet = {
      addModule: (url: unknown) => {
        moduleUrl = url;
        return Promise.resolve();
      },
    };
    const audio = new EngineAudio(() => ctx as unknown as AudioContext, SOUND);
    audio.start();
    audio.update(6000, 0.7, [0.3, 0.3, 0.3, 0.3]);
    await flush();
    expect(String(moduleUrl)).toContain('engineWorklet');
    expect(audio.getStats()).toEqual({ running: true, engine: 'worklet', firingHz: (6000 * 8) / 120 });
    const workletNode = FakeWorkletNode.instances[0];
    expect(workletNode.options.processorOptions?.cylinders).toBe(8);
    expect(workletNode.messages.at(-1)).toEqual({ rpm: 6000, throttle: 0.7 });
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(ctx.gains[2].gain.value).toBeGreaterThan(0);
    expect(ctx.gains[3].gain.value).toBeGreaterThan(0);
    audio.setMasterVolume(0);
    expect(ctx.gains[3].gain.value).toBe(0);
  });

  it('setSound rebuilds the node and dispose disconnects it', async () => {
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeWorkletNode;
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = new EngineAudio(() => ctx as unknown as AudioContext);
    await flush();
    expect(FakeWorkletNode.instances.length).toBe(1);
    audio.setSound(SOUND);
    expect(FakeWorkletNode.instances.length).toBe(2);
    expect(FakeWorkletNode.instances[0].disconnected).toBe(1);
    expect(FakeWorkletNode.instances[1].options.processorOptions?.cylinders).toBe(8);
    audio.dispose();
    expect(FakeWorkletNode.instances[1].disconnected).toBe(1);
    const stats = audio.getStats();
    expect(stats.running).toBe(false);
    expect(stats).toEqual({ running: false, engine: 'oscillator', firingHz: 0 });
  });
});

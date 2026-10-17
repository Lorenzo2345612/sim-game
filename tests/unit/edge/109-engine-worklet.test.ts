import { afterEach, describe, expect, it } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';
import type { CarSound } from '../../../src/physics/carSpec';
import { legacySynthSpec } from '../../../src/audio/soundSpec';

interface EngineStats {
  running: boolean;
  engine: 'worklet' | 'oscillator';
  firingHz: number;
}

interface FakeParam {
  value: number;
  setValueAtTime(value: number): FakeParam;
  linearRampToValueAtTime(value: number): FakeParam;
  setTargetAtTime(value: number): FakeParam;
  cancelScheduledValues(): FakeParam;
}

function param(initial = 0): FakeParam {
  const p: FakeParam = {
    value: initial,
    setValueAtTime(v: number) {
      p.value = v;
      return p;
    },
    linearRampToValueAtTime(v: number) {
      p.value = v;
      return p;
    },
    setTargetAtTime(v: number) {
      p.value = v;
      return p;
    },
    cancelScheduledValues() {
      return p;
    },
  };
  return p;
}

type FakeNode = { connect(target: unknown): unknown; disconnect(): void };

function stubNode<T extends object>(extra: T): T & FakeNode {
  return {
    ...extra,
    connect(target: unknown) {
      return target;
    },
    disconnect() {
      /* mock */
    },
  } as T & FakeNode;
}

interface PendingAdd {
  resolve: () => void;
  reject: (e: unknown) => void;
}

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});
  gains: Array<{ gain: FakeParam }> = [];
  started: string[] = [];
  closeCount = 0;
  addModuleUrls: unknown[] = [];
  audioWorklet?: { addModule(url: unknown): Promise<void> };
  private pending: PendingAdd[] = [];

  installWorklet(): void {
    this.audioWorklet = {
      addModule: (url: unknown) => {
        this.addModuleUrls.push(url);
        return new Promise<void>((resolve, reject) => {
          this.pending.push({ resolve, reject });
        });
      },
    };
  }

  resolveAddModules(): void {
    for (const p of this.pending.splice(0)) p.resolve();
  }

  rejectAddModules(e: unknown): void {
    for (const p of this.pending.splice(0)) p.reject(e);
  }

  addEventListener() {
    /* mock */
  }

  removeEventListener() {
    /* mock */
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  createOscillator() {
    return stubNode({
      type: 'sine',
      frequency: param(440),
      detune: param(0),
      onended: null,
      start: () => {
        this.started.push('osc');
      },
      stop: () => {
        /* mock */
      },
    });
  }

  createGain() {
    const g = stubNode({ gain: param() });
    this.gains.push(g);
    return g;
  }

  createBiquadFilter() {
    return stubNode({
      type: 'lowpass',
      frequency: param(350),
      Q: param(1),
      gain: param(0),
      detune: param(0),
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
    return stubNode({
      buffer: null,
      loop: false,
      playbackRate: param(1),
      onended: null,
      start: () => {
        this.started.push('noise');
      },
      stop: () => {
        /* mock */
      },
    });
  }
}

interface EngineAudioApi {
  start(): void;
  resume(): void;
  update(rpm: number, throttle: number, slipRatios: readonly number[]): void;
  setMasterVolume(v: number): void;
  dispose(): void;
  getStats(): EngineStats;
}

const AudioCtor = EngineAudio as unknown as new (
  createContext?: () => AudioContext,
  sound?: CarSound,
) => EngineAudioApi;

function makeAudio(ctx: FakeContext, sound?: CarSound): EngineAudioApi {
  return new AudioCtor(() => ctx as unknown as AudioContext, sound);
}

interface WorkletNodeRecord {
  name: string;
  processorOptions: Record<string, unknown> | undefined;
  connectCount: number;
  disconnectCount: number;
}

const globals = globalThis as unknown as {
  AudioWorkletNode?: unknown;
  AudioWorkletProcessor?: unknown;
  registerProcessor?: unknown;
  sampleRate?: number;
};

function installWorkletNodeGlobal(): WorkletNodeRecord[] {
  const instances: WorkletNodeRecord[] = [];
  globals.AudioWorkletNode = class {
    record: WorkletNodeRecord;
    constructor(_ctx: unknown, name: string, options?: { processorOptions?: Record<string, unknown> }) {
      this.record = {
        name,
        processorOptions: options?.processorOptions,
        connectCount: 0,
        disconnectCount: 0,
      };
      instances.push(this.record);
    }
    connect(): void {
      this.record.connectCount += 1;
    }
    disconnect(): void {
      this.record.disconnectCount += 1;
    }
  };
  return instances;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const V8_SOUND: CarSound = {
  cylinders: 8,
  exhaustLengthM: 1.4,
  intakeMix: 0.25,
  crackle: 0.5,
  synth: legacySynthSpec({ cylinders: 8, exhaustLengthM: 1.4, intakeMix: 0.25, crackle: 0.5 }),
};

afterEach(() => {
  delete globals.AudioWorkletNode;
  delete globals.AudioWorkletProcessor;
  delete globals.registerProcessor;
  delete globals.sampleRate;
});

describe('109 engine worklet edge cases', () => {
  it('EDGE1: getStats().running is false before start() and true after start()', () => {
    const audio = makeAudio(new FakeContext());
    expect(audio.getStats().running).toBe(false);
    audio.start();
    expect(audio.getStats().running).toBe(true);
  });

  it('EDGE2: getStats().firingHz is rpm/60 · cylinders/2 from the last update and the constructor sound', () => {
    const audio = makeAudio(new FakeContext());
    audio.update(6000, 1, [0, 0, 0, 0]);
    expect(audio.getStats().firingHz).toBeCloseTo((6000 / 60) * (4 / 2), 6);
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(audio.getStats().firingHz).toBeCloseTo((3000 / 60) * (4 / 2), 6);
    const v8 = makeAudio(new FakeContext(), V8_SOUND);
    v8.update(6000, 1, [0, 0, 0, 0]);
    expect(v8.getStats().firingHz).toBeCloseTo((6000 / 60) * (8 / 2), 6);
  });

  it('EDGE3: getStats().firingHz is 0 for zero and negative last rpm', () => {
    const audio = makeAudio(new FakeContext());
    audio.update(0, 0.5, [0, 0, 0, 0]);
    expect(audio.getStats().firingHz).toBeCloseTo(0, 6);
    audio.update(-500, 0.5, [0, 0, 0, 0]);
    expect(audio.getStats().firingHz).toBeCloseTo(0, 6);
  });

  it('EDGE4: update before the worklet is ready only stores values and stats stay oscillator', () => {
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.resume();
    expect(() => audio.update(6000, 1, [0, 0, 0, 0])).not.toThrow();
    const stats = audio.getStats();
    expect(stats.engine).toBe('oscillator');
    expect(stats.firingHz).toBeCloseTo((6000 / 60) * (4 / 2), 6);
  });

  it('EDGE5: a rejecting addModule falls back to the started oscillators without throwing', async () => {
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.resume();
    ctx.rejectAddModules(new Error('addModule failed'));
    await flush();
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.started.filter((n) => n === 'osc').length).toBeGreaterThanOrEqual(2);
    expect(() => audio.update(3000, 0.5, [0, 0, 0, 0])).not.toThrow();
  });

  it('EDGE6: once addModule resolves the engine is worklet with processor engine-synth and processorOptions from sound', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx, V8_SOUND);
    audio.start();
    audio.resume();
    ctx.resolveAddModules();
    await flush();
    expect(audio.getStats().engine).toBe('worklet');
    expect(instances.length).toBe(1);
    expect(instances[0].name).toBe('engine-synth');
    const options = instances[0].processorOptions;
    expect(options).toBeDefined();
    expect(options!.cylinders).toBe(8);
    expect(options!.exhaustLengthM).toBeCloseTo(1.4, 6);
    expect(options!.intakeMix).toBeCloseTo(0.25, 6);
    expect(Number.isFinite(options!.seed)).toBe(true);
    expect(instances[0].connectCount).toBeGreaterThan(0);
  });

  it('EDGE7: dispose() in worklet mode disconnects the worklet node, closes the context and stops running', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.resume();
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(1);
    audio.dispose();
    expect(instances[0].disconnectCount).toBeGreaterThan(0);
    expect(ctx.closeCount).toBeGreaterThanOrEqual(1);
    expect(() => audio.getStats()).not.toThrow();
    expect(audio.getStats().running).toBe(false);
  });

  it('EDGE8: tyre squeal still drives a gain in worklet mode', async () => {
    installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.resume();
    ctx.resolveAddModules();
    await flush();
    expect(audio.getStats().engine).toBe('worklet');
    audio.update(3000, 0.5, [0.3, 0, 0, 0]);
    expect(ctx.gains.some((g) => Math.abs(g.gain.value - 0.0625) < 1e-6)).toBe(true);
  });

  it('EDGE9: the worklet module registers engine-synth and process() renders a 128-frame block', async () => {
    type MsgHandler = (e: { data: unknown }) => void;
    const handlers: MsgHandler[] = [];
    const registered: Array<{ name: string; ctor: new (options: {
      processorOptions?: Record<string, unknown>;
    }) => {
      port: {
        onmessage: MsgHandler | null;
        postMessage(m: unknown): void;
        addEventListener(t: string, fn: MsgHandler): void;
      };
      process(inputs: unknown, outputs: Float32Array[][], parameters?: Record<string, Float32Array>): boolean;
    } }> = [];
    globals.AudioWorkletProcessor = class {
      port = {
        onmessage: null as MsgHandler | null,
        postMessage(): void {
          /* mock */
        },
        addEventListener(_t: string, fn: MsgHandler): void {
          handlers.push(fn);
        },
      };
    };
    globals.registerProcessor = (
      name: string,
      ctor: new (options: { processorOptions?: Record<string, unknown> }) => {
        port: {
          onmessage: MsgHandler | null;
          postMessage(m: unknown): void;
          addEventListener(t: string, fn: MsgHandler): void;
        };
        process(inputs: unknown, outputs: Float32Array[][], parameters?: Record<string, Float32Array>): boolean;
      },
    ) => {
      registered.push({ name, ctor });
    };
    globals.sampleRate = 48000;

    await import('../../../src/audio/engineWorklet');

    expect(registered.length).toBe(1);
    expect(registered[0].name).toBe('engine-synth');
    const proc = new registered[0].ctor({
      processorOptions: { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, seed: 1 },
    });
    const data = { rpm: 3000, throttle: 0.5 };
    proc.port.onmessage?.({ data });
    for (const h of handlers) h({ data });
    const out = new Float32Array(128);
    const kept = proc.process([], [[out]], {
      rpm: new Float32Array(128).fill(3000),
      throttle: new Float32Array(128).fill(0.5),
    });
    expect(kept).toBe(true);
    expect(Array.from(out).every((x) => Number.isFinite(x) && Math.abs(x) <= 1)).toBe(true);
    expect(out.some((x) => x !== 0)).toBe(true);
  });

  it('EDGE10: setMasterVolume(0) zeroes every gain in worklet mode', async () => {
    installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.installWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.resume();
    ctx.resolveAddModules();
    await flush();
    expect(audio.getStats().engine).toBe('worklet');
    audio.update(3000, 1, [0.3, 0, 0, 0]);
    audio.setMasterVolume(0);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';
import type { CarSound } from '../../../src/physics/carSpec';

interface FakeParam {
  value: number;
  setValueAtTime(v: number): FakeParam;
  linearRampToValueAtTime(v: number): FakeParam;
  setTargetAtTime(v: number): FakeParam;
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
  closeCount = 0;
  addModuleUrls: unknown[] = [];
  audioWorklet?: { addModule?: (url: unknown) => Promise<void> };
  private pending: PendingAdd[] = [];

  pendingWorklet(): void {
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
      start() {
        /* mock */
      },
      stop() {
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
      start() {
        /* mock */
      },
      stop() {
        /* mock */
      },
    });
  }
}

interface EngineStats {
  running: boolean;
  engine: 'worklet' | 'oscillator';
  firingHz: number;
}

interface WorkletRecord {
  name: string;
  processorOptions: Record<string, unknown> | undefined;
  messages: unknown[];
  postThrows: boolean;
  disconnected: number;
}

const globals = globalThis as unknown as {
  AudioWorkletNode?: unknown;
  AudioWorkletProcessor?: unknown;
  registerProcessor?: unknown;
  sampleRate?: number;
};

function installWorkletNode(opts?: { postThrows?: boolean; ctorThrows?: boolean }): WorkletRecord[] {
  const instances: WorkletRecord[] = [];
  globals.AudioWorkletNode = class {
    record: WorkletRecord;
    port: {
      postMessage(m: unknown): void;
      close(): void;
    };
    constructor(_ctx: unknown, name: string, options?: { processorOptions?: Record<string, unknown> }) {
      if (opts?.ctorThrows) throw new Error('node refused');
      this.record = {
        name,
        processorOptions: options?.processorOptions,
        messages: [],
        postThrows: opts?.postThrows === true,
        disconnected: 0,
      };
      this.port = {
        postMessage: (m: unknown) => {
          if (this.record.postThrows) throw new Error('port closed');
          this.record.messages.push(m);
        },
        close() {
          /* mock */
        },
      };
      instances.push(this.record);
    }
    connect(): void {
      /* mock */
    }
    disconnect(): void {
      this.record.disconnected += 1;
    }
  };
  return instances;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

const V8: CarSound = { cylinders: 8, exhaustLengthM: 1.4, intakeMix: 0.25, crackle: 0.5 };

function makeAudio(ctx: FakeContext, sound?: CarSound): {
  start(): void;
  update(rpm: number, throttle: number, slips: readonly number[]): void;
  setSound(s: CarSound): void;
  setMasterVolume(v: number): void;
  dispose(): void;
  getStats(): EngineStats;
} {
  const Ctor = EngineAudio as unknown as new (
    createContext?: () => AudioContext,
    sound?: CarSound,
  ) => ReturnType<typeof makeAudio>;
  return new Ctor(() => ctx as unknown as AudioContext, sound);
}

afterEach(() => {
  delete globals.AudioWorkletNode;
  delete globals.AudioWorkletProcessor;
  delete globals.registerProcessor;
  delete globals.sampleRate;
});

describe('109 engine worklet post gaps', () => {
  it('POST1: engineWorklet source never references three and imports only engineSynth', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'src', 'audio', 'engineWorklet.ts'), 'utf8');
    expect(src.includes('three')).toBe(false);
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['./engineSynth']);
  });

  it('POST2: a rejected addModule restores oscillator gains from the stored rpm/throttle without a further update', async () => {
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(ctx.gains[0].gain.value).toBe(0);
    ctx.rejectAddModules(new Error('no worklet'));
    await flush();
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 6);
    expect(ctx.gains[1].gain.value).toBeCloseTo(0.3 * 0.5, 6);
  });

  it('POST3: an audioWorklet getter that throws leaves the oscillator path driven by update', () => {
    const ctx = new FakeContext();
    Object.defineProperty(ctx, 'audioWorklet', {
      get() {
        throw new Error('no worklet');
      },
    });
    const audio = makeAudio(ctx);
    expect(() => audio.update(3000, 1, [0, 0, 0, 0])).not.toThrow();
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 6);
  });

  it('POST4: audioWorklet without addModule leaves the oscillator path driven by update', () => {
    const ctx = new FakeContext();
    ctx.audioWorklet = {};
    const audio = makeAudio(ctx);
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 6);
  });

  it('POST5: a synchronously throwing addModule falls back to oscillator gains on update', () => {
    const ctx = new FakeContext();
    ctx.audioWorklet = {
      addModule: () => {
        throw new Error('sync fail');
      },
    };
    const audio = makeAudio(ctx);
    expect(() => audio.update(3000, 1, [0, 0, 0, 0])).not.toThrow();
    expect(audio.getStats().engine).toBe('oscillator');
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 6);
  });

  it('POST6: a throwing AudioWorkletNode constructor falls back to the oscillators', async () => {
    installWorkletNode({ ctorThrows: true });
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.update(3000, 1, [0, 0, 0, 0]);
    ctx.resolveAddModules();
    await flush();
    expect(audio.getStats().engine).toBe('oscillator');
    audio.update(3000, 1, [0, 0, 0, 0]);
    expect(ctx.gains[0].gain.value).toBeCloseTo(0.6 * 0.5, 6);
  });

  it('POST7: update after dispose is a no-op and stats stay frozen', async () => {
    const instances = installWorkletNode();
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    audio.update(6000, 1, [0, 0, 0, 0]);
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(1);
    const sent = instances[0].messages.length;
    audio.dispose();
    expect(() => audio.update(3000, 0, [0, 0, 0, 0])).not.toThrow();
    expect(instances[0].messages.length).toBe(sent);
    expect(audio.getStats()).toEqual({ running: false, engine: 'oscillator', firingHz: (6000 * 4) / 120 });
  });

  it('POST8: setSound changes the cylinders used by getStats().firingHz', () => {
    const audio = makeAudio(new FakeContext());
    audio.update(6000, 1, [0, 0, 0, 0]);
    expect(audio.getStats().firingHz).toBeCloseTo((6000 * 4) / 120, 6);
    audio.setSound(V8);
    expect(audio.getStats().firingHz).toBeCloseTo((6000 * 8) / 120, 6);
  });

  it('POST9: setSound while addModule is pending is applied to the node built after resolve', async () => {
    const instances = installWorkletNode();
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.setSound(V8);
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(1);
    expect(instances[0].processorOptions?.cylinders).toBe(8);
  });

  it('POST10: setSound after dispose does not build a worklet node', async () => {
    const instances = installWorkletNode();
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(1);
    audio.dispose();
    audio.setSound(V8);
    expect(instances.length).toBe(1);
  });

  it('POST11: update does not throw when the worklet port rejects messages', async () => {
    const instances = installWorkletNode({ postThrows: true });
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(1);
    expect(() => audio.update(6000, 1, [0.3, 0, 0, 0])).not.toThrow();
    expect(audio.getStats().engine).toBe('worklet');
  });

  it('POST12: dispose before addModule resolves never creates a worklet node', async () => {
    const instances = installWorkletNode();
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.dispose();
    ctx.resolveAddModules();
    await flush();
    expect(instances.length).toBe(0);
    expect(audio.getStats().running).toBe(false);
  });

  it('POST13: worklet process returns true and renders nothing on empty or missing output channels', async () => {
    type Ctor = new (options: { processorOptions?: Record<string, unknown> }) => {
      port: { onmessage: ((e: { data: unknown }) => void) | null };
      process(inputs: unknown, outputs: Float32Array[][]): boolean;
    };
    const registered: Array<{ name: string; ctor: Ctor }> = [];
    globals.AudioWorkletProcessor = class {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null };
    };
    globals.registerProcessor = (name: string, ctor: Ctor) => {
      registered.push({ name, ctor });
    };
    globals.sampleRate = 48000;
    vi.resetModules();
    await import('../../../src/audio/engineWorklet');
    expect(registered.length).toBe(1);
    const proc = new registered[0].ctor({ processorOptions: { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, seed: 1 } });
    proc.port.onmessage?.({ data: { rpm: 6000, throttle: 1 } });
    expect(proc.process([], [])).toBe(true);
    expect(proc.process([], [[]])).toBe(true);
    const out = new Float32Array(128);
    expect(proc.process([], [[out]])).toBe(true);
  });

  it('POST14: missing processorOptions render exactly like the explicit defaults', async () => {
    type Ctor = new (options?: { processorOptions?: Record<string, unknown> }) => {
      port: { onmessage: ((e: { data: unknown }) => void) | null };
      process(inputs: unknown, outputs: Float32Array[][]): boolean;
    };
    const registered: Array<{ name: string; ctor: Ctor }> = [];
    globals.AudioWorkletProcessor = class {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null };
    };
    globals.registerProcessor = (name: string, ctor: Ctor) => {
      registered.push({ name, ctor });
    };
    globals.sampleRate = 48000;
    vi.resetModules();
    await import('../../../src/audio/engineWorklet');
    const defaults = new registered[0].ctor({});
    const explicit = new registered[0].ctor({
      processorOptions: { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, seed: 1 },
    });
    const msg = { rpm: 6000, throttle: 0.8 };
    defaults.port.onmessage?.({ data: msg });
    explicit.port.onmessage?.({ data: msg });
    const a = new Float32Array(128);
    const b = new Float32Array(128);
    defaults.process([], [[a]]);
    explicit.process([], [[b]]);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.some((x) => x !== 0)).toBe(true);
  });

  it('POST15: garbage port messages do not throw and a later valid message still drives output', async () => {
    type Ctor = new (options: { processorOptions?: Record<string, unknown> }) => {
      port: { onmessage: ((e: { data: unknown }) => void) | null };
      process(inputs: unknown, outputs: Float32Array[][]): boolean;
    };
    const registered: Array<{ name: string; ctor: Ctor }> = [];
    globals.AudioWorkletProcessor = class {
      port = { onmessage: null as ((e: { data: unknown }) => void) | null };
    };
    globals.registerProcessor = (name: string, ctor: Ctor) => {
      registered.push({ name, ctor });
    };
    globals.sampleRate = 48000;
    vi.resetModules();
    await import('../../../src/audio/engineWorklet');
    const proc = new registered[0].ctor({ processorOptions: { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, seed: 1 } });
    const out = new Float32Array(128);
    for (const data of [null, 'rpm', { rpm: '6000', throttle: 'loud' }, { rpm: [1], throttle: {} }, []]) {
      expect(() => proc.port.onmessage?.({ data })).not.toThrow();
      expect(proc.process([], [[out]])).toBe(true);
      expect(Array.from(out).every((x) => Number.isFinite(x))).toBe(true);
    }
    proc.port.onmessage?.({ data: { rpm: 6000, throttle: 1 } });
    proc.process([], [[out]]);
    expect(out.some((x) => x !== 0)).toBe(true);
  });

  it('POST16: the worklet gain target is 0.5 times master volume', async () => {
    installWorkletNode();
    const ctx = new FakeContext();
    ctx.pendingWorklet();
    const audio = makeAudio(ctx);
    audio.start();
    ctx.resolveAddModules();
    await flush();
    audio.setMasterVolume(1);
    expect(ctx.gains[ctx.gains.length - 1].gain.value).toBeCloseTo(0.5, 6);
    audio.setMasterVolume(0.2);
    expect(ctx.gains[ctx.gains.length - 1].gain.value).toBeCloseTo(0.1, 6);
  });
});

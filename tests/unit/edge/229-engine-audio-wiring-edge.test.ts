import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineAudio } from '../../../src/audio/engineAudio';
import { legacySynthSpec } from '../../../src/audio/soundSpec';
import type { CarSound } from '../../../src/physics/carSpec';

type MsgHandler = (e: { data: unknown }) => void;
interface Processor {
  port: { onmessage: MsgHandler | null };
  process(inputs: unknown, outputs: Float32Array[][]): boolean;
}
type ProcessorCtor = new (options: { processorOptions?: Record<string, unknown> }) => Processor;

const globals = globalThis as unknown as {
  AudioWorkletNode?: unknown;
  AudioWorkletProcessor?: unknown;
  registerProcessor?: unknown;
  sampleRate?: number;
};

const SEED = 3;
const OPTS = { seed: SEED };

async function makeProc(synth: unknown): Promise<Processor> {
  const registered: Array<{ name: string; ctor: ProcessorCtor }> = [];
  globals.AudioWorkletProcessor = class {
    port = { onmessage: null as MsgHandler | null };
  };
  globals.registerProcessor = (name: string, ctor: ProcessorCtor) => {
    registered.push({ name, ctor });
  };
  globals.sampleRate = 48000;
  vi.resetModules();
  await import('../../../src/audio/engineWorklet');
  expect(registered.length).toBe(1);
  expect(registered[0].name).toBe('engine-synth');
  return new registered[0].ctor({ processorOptions: { synth, ...OPTS } });
}

function renderBlocks(proc: Processor, n: number): Float32Array[] {
  const blocks: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const out = new Float32Array(128);
    proc.process([], [[out]]);
    blocks.push(out);
  }
  return blocks;
}

function rmsLast(blocks: Float32Array[], n: number): number {
  let sum = 0;
  let count = 0;
  for (let i = blocks.length - n; i < blocks.length; i++) {
    for (const x of blocks[i]) {
      sum += x * x;
      count += 1;
    }
  }
  return Math.sqrt(sum / count);
}

function expectSameBlocks(a: Float32Array[], b: Float32Array[]): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(Array.from(a[i])).toEqual(Array.from(b[i]));
  }
}

interface FakeParam {
  value: number;
  setValueAtTime(v: number): FakeParam;
  linearRampToValueAtTime(v: number): FakeParam;
  exponentialRampToValueAtTime(v: number): FakeParam;
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
    exponentialRampToValueAtTime(v: number) {
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

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});
  bufferStarts = 0;
  audioWorklet?: { addModule(url: unknown): Promise<void> };

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
    return stubNode({
      type: 'sine' as const,
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
    return stubNode({ gain: param() });
  }

  createBiquadFilter() {
    return stubNode({
      type: 'lowpass' as const,
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
        this.bufferStarts += 1;
      },
      stop() {
        /* mock */
      },
    });
  }
}

interface EngineAudioApi {
  start(): void;
  update(
    rpm: number,
    throttle: number,
    slipRatios: readonly number[],
    extra?: { load?: number; wheelSpeedMs?: number },
  ): void;
  updateEffects(s: { speed: number; surface: string; shifting: boolean; slipRatios: readonly number[] }): void;
  setLimiterRpm(rpm: number): void;
  getStats(): { running: boolean; engine: 'worklet' | 'oscillator'; firingHz: number };
}

function makeAudio(ctx: FakeContext, sound?: CarSound): EngineAudioApi {
  const Ctor = EngineAudio as unknown as new (
    createContext?: () => AudioContext,
    sound?: CarSound,
  ) => EngineAudioApi;
  return new Ctor(() => ctx as unknown as AudioContext, sound);
}

interface WorkletRecord {
  processorOptions: Record<string, unknown> | undefined;
  messages: Array<Record<string, unknown>>;
  disconnected: number;
}

function installWorkletNodeGlobal(): WorkletRecord[] {
  const instances: WorkletRecord[] = [];
  globals.AudioWorkletNode = class {
    record: WorkletRecord;
    port: { postMessage(m: Record<string, unknown>): void; close(): void };
    constructor(_ctx: unknown, _name: string, options?: { processorOptions?: Record<string, unknown> }) {
      this.record = { processorOptions: options?.processorOptions, messages: [], disconnected: 0 };
      this.port = {
        postMessage: (m: Record<string, unknown>) => {
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

const GT3_SOUND: CarSound = {
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
  vi.restoreAllMocks();
});

describe('229 engine audio wiring edges', () => {
  it('EDGE1: worklet message fields with the wrong type are ignored', async () => {
    const a = await makeProc(GT3_SOUND.synth);
    const b = await makeProc(GT3_SOUND.synth);
    const valid = { rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0, limiter: false };
    a.port.onmessage?.({ data: valid });
    b.port.onmessage?.({ data: valid });
    renderBlocks(a, 80);
    renderBlocks(b, 80);
    a.port.onmessage?.({
      data: { rpm: 'x', load: {}, throttle: true, wheelSpeedMs: null, limiter: 1 },
    });
    const segA = renderBlocks(a, 60);
    const segB = renderBlocks(b, 60);
    expectSameBlocks(segA, segB);
    expect(rmsLast(segA, 30)).toBeGreaterThan(0.001);
  });

  it('EDGE2: a message without load uses the message throttle as load', async () => {
    const a = await makeProc(GT3_SOUND.synth);
    const b = await makeProc(GT3_SOUND.synth);
    a.port.onmessage?.({ data: { rpm: 4000, throttle: 0.7 } });
    b.port.onmessage?.({ data: { rpm: 4000, load: 0.7, throttle: 0.7 } });
    const segA = renderBlocks(a, 80);
    const segB = renderBlocks(b, 80);
    expectSameBlocks(segA, segB);
    expect(rmsLast(segA, 40)).toBeGreaterThan(0.001);
  });

  it('EDGE3: a message without limiter keeps the previous limiter flag', async () => {
    const a = await makeProc(GT3_SOUND.synth);
    const b = await makeProc(GT3_SOUND.synth);
    const first = { rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0, limiter: true };
    a.port.onmessage?.({ data: first });
    b.port.onmessage?.({ data: first });
    renderBlocks(a, 60);
    renderBlocks(b, 60);
    const second = { rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0 };
    a.port.onmessage?.({ data: second });
    b.port.onmessage?.({ data: { ...second, limiter: true } });
    expectSameBlocks(renderBlocks(a, 60), renderBlocks(b, 60));
  });

  it('EDGE4: every process call renders finite samples and returns true', async () => {
    const p = await makeProc(GT3_SOUND.synth);
    p.port.onmessage?.({ data: { rpm: 5000, load: 1, throttle: 1, wheelSpeedMs: 0, limiter: false } });
    for (let i = 0; i < 5; i++) {
      const out = new Float32Array(128);
      expect(p.process([], [[out]])).toBe(true);
      expect(Array.from(out).every((x) => Number.isFinite(x))).toBe(true);
    }
  });

  it('EDGE5: non-finite extra load and wheelSpeedMs fall back to throttle and 0', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    audio.update(6000, 0.35, [], { load: Number.NaN, wheelSpeedMs: Number.NaN });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.35,
      throttle: 0.35,
      wheelSpeedMs: 0,
      limiter: false,
    });
    audio.update(6000, 0.35, [], { load: Number.POSITIVE_INFINITY });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0.35,
      throttle: 0.35,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('EDGE6: out-of-range extra clamps load to [0,1] and wheelSpeedMs to >= 0', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    audio.update(6000, 0.5, [], { load: 2.5, wheelSpeedMs: -40 });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 1,
      throttle: 0.5,
      wheelSpeedMs: 0,
      limiter: false,
    });
    audio.update(6000, 0.5, [], { load: -1, wheelSpeedMs: 0 });
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 6000,
      load: 0,
      throttle: 0.5,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('EDGE7: the default limiter threshold is inclusive at exactly 8950 rpm', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    audio.update(8950, 1, []);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 8950,
      load: 1,
      throttle: 1,
      wheelSpeedMs: 0,
      limiter: true,
    });
    audio.update(8949, 1, []);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 8949,
      load: 1,
      throttle: 1,
      wheelSpeedMs: 0,
      limiter: false,
    });
  });

  it('EDGE8: update does not mutate the extra argument', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    await flush();
    const extra = { load: 0.55, wheelSpeedMs: 12 };
    const snapshot = { ...extra };
    audio.update(7000, 0.9, [], extra);
    expect(extra).toEqual(snapshot);
    expect(instances[0].messages.at(-1)).toEqual({
      rpm: 7000,
      load: 0.55,
      throttle: 0.9,
      wheelSpeedMs: 12,
      limiter: false,
    });
  });

  it('EDGE9: crackle one-shots are still scheduled while addModule is pending', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const ctx = new FakeContext();
    ctx.audioWorklet = {
      addModule: () => new Promise<void>(() => {
        /* never resolves within the test */
      }),
    };
    const audio = makeAudio(ctx, GT3_SOUND);
    audio.start();
    audio.updateEffects({ speed: 0, surface: 'asphalt', shifting: false, slipRatios: [0, 0, 0, 0] });
    await flush();
    expect(audio.getStats().engine).toBe('oscillator');
    const before = ctx.bufferStarts;
    audio.update(8500, 1, []);
    audio.update(8500, 0, []);
    expect(ctx.bufferStarts - before).toBe(4);
  });

  it('EDGE10: the initial worklet node receives processorOptions.synth and a finite seed', async () => {
    const instances = installWorkletNodeGlobal();
    const ctx = new FakeContext();
    ctx.audioWorklet = { addModule: () => Promise.resolve() };
    makeAudio(ctx, GT3_SOUND);
    await flush();
    expect(instances.length).toBe(1);
    const opts = instances[0].processorOptions as { synth?: unknown; seed?: unknown } | undefined;
    expect(opts?.synth).toEqual(GT3_SOUND.synth);
    expect(typeof opts?.seed).toBe('number');
    expect(Number.isFinite(opts?.seed)).toBe(true);
  });
});

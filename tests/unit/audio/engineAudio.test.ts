import { describe, it, expect } from 'vitest';
import { EngineAudio, engineParams, tyreSquealGain } from '../../../src/audio/engineAudio';

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
  resumeCount = 0;
  closeCount = 0;
  started: string[] = [];
  stopped: string[] = [];
  state = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = node({});

  resume(): Promise<void> {
    this.resumeCount += 1;
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
    return node({
      type: 'sine',
      frequency: new FakeParam(440),
      detune: new FakeParam(0),
      onended: null,
      start: () => {
        this.started.push('osc');
      },
      stop: () => {
        this.stopped.push('osc');
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
      type: 'lowpass',
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
      buffer: null as unknown,
      loop: false,
      playbackRate: new FakeParam(1),
      onended: null,
      start: () => {
        this.started.push('noise');
      },
      stop: () => {
        this.stopped.push('noise');
      },
    });
  }
}

function audioWith(ctx: FakeContext): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext);
}

describe('051 engine audio edge cases', () => {
  it('engineParams clamps rpm and throttle and stays monotonic', () => {
    expect(engineParams(3000, 0).frequencyHz).toBeCloseTo(100, 6);
    expect(engineParams(-500, 1).frequencyHz).toBe(0);
    expect(engineParams(3000, 0).gain).toBeCloseTo(0.15, 6);
    expect(engineParams(3000, 1).gain).toBeCloseTo(0.6, 6);
    expect(engineParams(3000, 5).gain).toBe(engineParams(3000, 1).gain);
    expect(engineParams(3000, -1).gain).toBe(engineParams(3000, 0).gain);
    expect(engineParams(9000, 0.25).gain).toBeLessThan(engineParams(9000, 0.75).gain);
  });

  it('tyreSquealGain handles empty, boundary and saturating inputs', () => {
    expect(tyreSquealGain([])).toBe(0);
    expect(tyreSquealGain([0.1, 0.1, 0.1, 0.1])).toBe(0);
    expect(tyreSquealGain([0.09, 0, 0, 0])).toBe(0);
    expect(tyreSquealGain([0.15, 0, 0, 0])).toBeGreaterThan(0);
    expect(tyreSquealGain([1, 1, 1, 1])).toBeCloseTo(0.5, 6);
    expect(tyreSquealGain([0.2, 0.2, 0, 0])).toBeGreaterThan(tyreSquealGain([0.2, 0, 0, 0]));
    expect(tyreSquealGain([0.3, 0, 0, 0])).toBeGreaterThan(tyreSquealGain([0.15, 0, 0, 0]));
  });

  it('start() is idempotent and never resumes the context', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    expect(() => {
      audio.start();
      audio.start();
    }).not.toThrow();
    expect(ctx.resumeCount).toBe(0);
    expect(ctx.state).toBe('suspended');
    expect(ctx.started.length).toBeGreaterThanOrEqual(3);
    audio.resume();
    expect(ctx.resumeCount).toBe(1);
    expect(ctx.state).toBe('running');
  });

  it('default master volume scales the idle gains by 0.5', () => {
    const ctx = new FakeContext();
    audioWith(ctx);
    expect(ctx.gains.length).toBe(3);
    for (const g of ctx.gains) expect(g.gain.value).toBeGreaterThanOrEqual(0);
    expect(ctx.gains[0].gain.value).toBeCloseTo(engineParams(3000, 0).gain * 0.5, 6);
    expect(ctx.gains[2].gain.value).toBe(0);
  });

  it('update() before start() smooths gains with setTargetAtTime', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    expect(() => audio.update(8000, 1, [0.3, 0.3, 0.3, 0.3])).not.toThrow();
    for (const g of ctx.gains) expect(g.gain.targets.length).toBeGreaterThan(0);
    expect(ctx.gains[0].gain.value).toBeCloseTo(engineParams(8000, 1).gain * 0.5, 6);
    expect(ctx.gains[2].gain.value).toBeCloseTo(tyreSquealGain([0.3, 0.3, 0.3, 0.3]) * 0.5, 6);
  });

  it('setMasterVolume clamps outside 0..1 and zeroes every gain at 0', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.update(3000, 1, [0.25, 0, 0, 0]);
    audio.setMasterVolume(2);
    expect(ctx.gains[0].gain.value).toBeCloseTo(engineParams(3000, 1).gain, 6);
    audio.setMasterVolume(-1);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
    audio.update(3000, 1, [0.25, 0, 0, 0]);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
  });

  it('dispose() stops the sources, closes the context once and ignores later calls', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.start();
    audio.dispose();
    audio.dispose();
    expect(ctx.closeCount).toBe(1);
    expect(ctx.stopped.length).toBeGreaterThanOrEqual(3);
    expect(ctx.state).toBe('closed');
    expect(() => {
      audio.start();
      audio.resume();
      audio.update(3000, 1, [0.4, 0, 0, 0]);
      audio.setMasterVolume(1);
    }).not.toThrow();
    expect(ctx.resumeCount).toBe(0);
  });
});

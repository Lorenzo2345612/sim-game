import { describe, it, expect } from 'vitest';
import { EngineAudio, engineParams, tyreSquealGain } from '../../../src/audio/engineAudio';

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

class FakeContext {
  gains: Array<{ gain: FakeParam }> = [];
  resumeCount = 0;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = stubNode({});
  onstatechange: unknown = null;

  addEventListener() {
    /* mock */
  }

  removeEventListener() {
    /* mock */
  }

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
    const node = stubNode({ gain: param() });
    this.gains.push(node);
    return node;
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

function audioWith(ctx: FakeContext): EngineAudio {
  return new EngineAudio(() => ctx as unknown as AudioContext);
}

describe('051 engine and tyre audio acceptance', () => {
  it('AT1: engineParams base frequency is rpm/60 × 2 Hz and gain increases with throttle', () => {
    expect(engineParams(3000, 1).frequencyHz).toBeCloseTo(100, 6);
    expect(engineParams(9000, 1).frequencyHz).toBeCloseTo(300, 6);
    expect(engineParams(3000, 1).gain).toBeGreaterThan(engineParams(3000, 0).gain);
    expect(engineParams(9000, 1).gain).toBeGreaterThan(engineParams(9000, 0).gain);
  });

  it('AT2: start() before a user gesture does not throw and the context starts on first resume', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    expect(() => audio.start()).not.toThrow();
    expect(ctx.state).toBe('suspended');
    audio.resume();
    expect(ctx.resumeCount).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe('running');
  });

  it('AT3: tyreSquealGain is > 0 with slip > 0.2 on 2 wheels and 0 when every slip < 0.1', () => {
    expect(tyreSquealGain([0.25, 0.25, 0, 0])).toBeGreaterThan(0);
    expect(tyreSquealGain([0.05, 0.05, 0.05, 0.05])).toBe(0);
  });

  it('AT4: master volume 0 drives all gains to 0', () => {
    const ctx = new FakeContext();
    const audio = audioWith(ctx);
    audio.start();
    audio.resume();
    audio.update(3000, 1, [0.25, 0.25, 0, 0]);
    expect(ctx.gains.filter((g) => g.gain.value > 0).length).toBeGreaterThanOrEqual(2);
    audio.setMasterVolume(0);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
    audio.update(3000, 1, [0.25, 0.25, 0, 0]);
    for (const g of ctx.gains) expect(g.gain.value).toBe(0);
  });
});

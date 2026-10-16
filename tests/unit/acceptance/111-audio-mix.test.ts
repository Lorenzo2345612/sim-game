import { describe, it, expect } from 'vitest';
import { loadVolumes, SETTINGS_KEY, type KeyValueStorage } from '../../../src/core/settings';
import { Mixer } from '../../../src/audio/mixer';

class FakeParam {
  value: number;
  events: Array<{ kind: 'set' | 'ramp'; value: number; time: number }> = [];
  constructor(initial = 0) {
    this.value = initial;
  }
  setValueAtTime(v: number, t: number): FakeParam {
    this.events.push({ kind: 'set', value: v, time: t });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): FakeParam {
    this.events.push({ kind: 'ramp', value: v, time: t });
    this.value = v;
    return this;
  }
  lastRamp(): { value: number; time: number } {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].kind === 'ramp') return this.events[i];
    }
    throw new Error('no ramp scheduled');
  }
}

class FakeContext {
  currentTime = 0;
}

function makeMixer(): {
  ctx: FakeContext;
  master: FakeParam;
  engineFilter: FakeParam;
  mixer: Mixer;
} {
  const ctx = new FakeContext();
  const master = new FakeParam(0);
  const engineFilter = new FakeParam(22050);
  const passthrough = { connect: () => undefined, disconnect: () => undefined };
  const nodes = {
    master: { ...passthrough, gain: master },
    engine: { ...passthrough, gain: new FakeParam(0) },
    effects: { ...passthrough, gain: new FakeParam(0) },
    engineFilter: { ...passthrough, type: 'lowpass', frequency: engineFilter, Q: new FakeParam(1) },
  };
  const mixer = new Mixer(
    ctx as unknown as AudioContext,
    nodes as unknown as {
      master: GainNode;
      engine: GainNode;
      effects: GainNode;
      engineFilter: BiquadFilterNode;
    },
    { master: 0.8, engine: 1, effects: 1 },
  );
  return { ctx, master, engineFilter, mixer };
}

describe('111 audio mix acceptance', () => {
  it('AT1: settings without volume load master 0.8, engine 1, effects 1', () => {
    const storage: KeyValueStorage = {
      getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify({ preset: 'high' }) : null),
      setItem: () => undefined,
    };
    const v = loadVolumes(storage);
    expect(v.master).toBeCloseTo(0.8, 9);
    expect(v.engine).toBeCloseTo(1, 9);
    expect(v.effects).toBeCloseTo(1, 9);
  });

  it('AT2: cockpit sets the engine filter to 1200 Hz; chase bypasses at 22050 Hz', () => {
    const { engineFilter, mixer } = makeMixer();
    mixer.setCameraMode('cockpit');
    expect(engineFilter.value).toBeCloseTo(1200, 9);
    mixer.setCameraMode('chase');
    expect(engineFilter.value).toBeCloseTo(22050, 9);
  });

  it('AT3: pause ramps master gain to 0 within 0.1 s and resume restores it within 0.1 s', () => {
    const { ctx, master, mixer } = makeMixer();
    ctx.currentTime = 3;
    mixer.setPaused(true);
    const down = master.lastRamp();
    expect(down.value).toBe(0);
    expect(down.time - 3).toBeLessThanOrEqual(0.1 + 1e-9);
    ctx.currentTime = 3.5;
    mixer.setPaused(false);
    const up = master.lastRamp();
    expect(up.value).toBeCloseTo(0.8, 9);
    expect(up.time - 3.5).toBeLessThanOrEqual(0.1 + 1e-9);
  });
});

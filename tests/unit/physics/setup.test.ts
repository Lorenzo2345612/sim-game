import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import {
  defaultSetup,
  presetSetup,
  clampSetup,
  applySetup,
  saveSetup,
  loadSetup,
  type Setup,
  type SetupStorage,
} from '../../../src/physics/setup';

const ROOT = join(__dirname, '..', '..', '..');

function f4Spec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
  return parseCarSpec(json);
}

class MapStorage implements SetupStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('setup edge cases', () => {
  it('clampSetup: NaN, ±Infinity and non-numbers fall back to each key default', () => {
    const spec = f4Spec();
    const garbage = {
      frontWing: NaN,
      rearWing: Infinity,
      brakeBias: -Infinity,
      finalDrive: '3.5',
      arbFront: null,
      arbRear: undefined,
      rideHeight: Number.NaN,
      tyrePressureKpa: {},
    } as unknown as Setup;
    expect(clampSetup(spec, garbage)).toEqual(defaultSetup(spec));
  });

  it('clampSetup: boundary min and max pass through unchanged', () => {
    const spec = f4Spec();
    const s: Setup = {
      frontWing: 0,
      rearWing: 10,
      brakeBias: 0.5,
      finalDrive: 3.8,
      arbFront: 6000,
      arbRear: 40000,
      rideHeight: -0.02,
      tyrePressureKpa: 160,
    };
    expect(clampSetup(spec, s)).toEqual(s);
  });

  it('clampSetup: exact halfway between two steps rounds up', () => {
    const spec = f4Spec();
    const out = clampSetup(spec, {
      ...defaultSetup(spec),
      brakeBias: 0.505,
      arbFront: 6500,
    });
    expect(out.brakeBias).toBeCloseTo(0.51, 12);
    expect(out.arbFront).toBe(7000);
  });

  it('clampSetup: on-step values survive a second clamp unchanged (idempotent)', () => {
    const spec = f4Spec();
    const once = clampSetup(spec, {
      ...defaultSetup(spec),
      brakeBias: 0.553,
      finalDrive: 3.517,
      rideHeight: 0.0031,
    });
    expect(clampSetup(spec, once)).toEqual(once);
  });

  it('clampSetup: does not mutate its input', () => {
    const spec = f4Spec();
    const input: Setup = { ...defaultSetup(spec), frontWing: 99, rideHeight: NaN };
    const before = structuredClone(input);
    clampSetup(spec, input);
    expect(input).toEqual(before);
  });

  it('applySetup: cda combines both wing deltas once per step; input spec and setup untouched', () => {
    const spec = f4Spec();
    const specBefore = structuredClone(spec);
    const setup: Setup = { ...defaultSetup(spec), frontWing: 2, rearWing: 8 };
    const setupBefore = structuredClone(setup);
    const out = applySetup(spec, setup);
    expect(out.aero.claFront).toBeCloseTo(0.8 + (2 - 5) * 0.06, 9);
    expect(out.aero.claRear).toBeCloseTo(1.2 + (8 - 5) * 0.09, 9);
    expect(out.aero.cda).toBeCloseTo(0.8 + (2 - 5 + 8 - 5) * 0.015, 9);
    expect(spec).toEqual(specBefore);
    expect(setup).toEqual(setupBefore);
  });

  it('applySetup: arbs and tyre pressure land on the returned spec only', () => {
    const spec = f4Spec();
    const out = applySetup(spec, {
      ...defaultSetup(spec),
      arbFront: 22000,
      arbRear: 9000,
      tyrePressureKpa: 155,
    });
    expect(out.suspension.front.arb).toBe(22000);
    expect(out.suspension.rear.arb).toBe(9000);
    expect(out.tyres.pressureKpa).toBe(155);
    expect(spec.suspension.front.arb).toBe(18000);
    expect(spec.tyres.pressureKpa).toBe(140);
  });

  it('applySetup: negative rideHeight lowers hubs and cg, suspension travel unchanged', () => {
    const spec = f4Spec();
    const out = applySetup(spec, { ...defaultSetup(spec), rideHeight: -0.008 });
    expect(out.chassis.cgHeight).toBeCloseTo(0.28 - 0.008, 9);
    expect(out.suspension.front.restLength).toBe(spec.suspension.front.restLength);
    expect(out.suspension.rear.restLength).toBe(spec.suspension.rear.restLength);
  });

  it('applySetup: default setup keeps wing aero exactly at spec values', () => {
    const spec = f4Spec();
    const out = applySetup(spec, defaultSetup(spec));
    expect(out.aero).toEqual(spec.aero);
  });

  it('defaultSetup returns a fresh object each call; mutating one does not affect the other', () => {
    const spec = f4Spec();
    const a = defaultSetup(spec);
    const b = defaultSetup(spec);
    expect(a).toEqual(b);
    a.frontWing = 0;
    expect(b.frontWing).toBe(5);
    expect(spec.setup.frontWing.default).toBe(5);
  });

  it('presetSetup returns a copy; mutating it leaves spec.presets intact', () => {
    const spec = f4Spec();
    const p = presetSetup(spec, 'aggressive');
    expect(p).toEqual(spec.presets.aggressive);
    p.rearWing = 99;
    expect(spec.presets.aggressive.rearWing).toBe(3);
  });

  it('saveSetup does not throw when setItem throws', () => {
    const storage: SetupStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(() => saveSetup('f4', 'monza', defaultSetup(f4Spec()), storage)).not.toThrow();
  });

  it('loadSetup: getItem throwing, empty object, arrays and non-8-key objects give defaults', () => {
    const spec = f4Spec();
    const def = defaultSetup(spec);
    const broken: SetupStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => undefined,
    };
    expect(loadSetup('f4', 'monza', spec, broken)).toEqual(def);

    const storage = new MapStorage();
    storage.setItem('setup:f4:monza', '{}');
    storage.setItem('setup:f4:suzuka', '[]');
    storage.setItem('setup:f4:interlagos', '5');
    storage.setItem('setup:f4:spa', JSON.stringify({ ...def, frontWing: 7 }));
    storage.setItem('setup:f4:zandvoort', JSON.stringify({ ...def, brakeBias: null }));
    storage.setItem('setup:f4:monaco', JSON.stringify({ ...def, extra: 1 }));
    expect(loadSetup('f4', 'monza', spec, storage)).toEqual(def);
    expect(loadSetup('f4', 'suzuka', spec, storage)).toEqual(def);
    expect(loadSetup('f4', 'interlagos', spec, storage)).toEqual(def);
    expect(loadSetup('f4', 'zandvoort', spec, storage)).toEqual(def);
    expect(loadSetup('f4', 'spa', spec, storage)).toEqual({ ...def, frontWing: 7 });
    // Extra unknown keys are ignored as long as the eight known values are finite numbers.
    expect(loadSetup('f4', 'monaco', spec, storage)).toEqual(def);
  });

  it('loadSetup: stored out-of-range values come back clamped', () => {
    const spec = f4Spec();
    const storage = new MapStorage();
    storage.setItem(
      'setup:f4:monza',
      JSON.stringify({
        frontWing: 99,
        rearWing: -2,
        brakeBias: 0.9,
        finalDrive: 1,
        arbFront: 6500,
        arbRear: 999999,
        rideHeight: -1,
        tyrePressureKpa: 10,
      }),
    );
    expect(loadSetup('f4', 'monza', spec, storage)).toEqual({
      frontWing: 10,
      rearWing: 0,
      brakeBias: 0.7,
      finalDrive: 3.2,
      arbFront: 7000,
      arbRear: 40000,
      rideHeight: -0.02,
      tyrePressureKpa: 120,
    });
  });

  it('save/load round-trips every preset for a car+track pair', () => {
    const spec = f4Spec();
    const storage = new MapStorage();
    for (const name of ['stable', 'balanced', 'aggressive'] as const) {
      const p = presetSetup(spec, name);
      saveSetup('f4', `track-${name}`, p, storage);
      expect(loadSetup('f4', `track-${name}`, spec, storage)).toEqual(p);
    }
  });
});

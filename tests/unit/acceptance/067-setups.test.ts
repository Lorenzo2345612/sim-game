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
} from '../../../src/physics/setup';

const ROOT = join(__dirname, '..', '..', '..');

function f4Spec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
  return parseCarSpec(json);
}

class MapStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('067 car setups acceptance', () => {
  it('AT1: applySetup with the default setup returns a spec deep-equal to the input spec', () => {
    const spec = f4Spec();
    expect(applySetup(spec, defaultSetup(spec))).toEqual(spec);
  });

  it('AT2: rearWing +2 raises aero.claRear by 0.18 and aero.cda by 0.03, input spec unchanged', () => {
    const spec = f4Spec();
    const before = structuredClone(spec);
    const setup: Setup = { ...defaultSetup(spec), rearWing: spec.setup.rearWing.default + 2 };
    const out = applySetup(spec, setup);
    expect(out.aero.claRear - spec.aero.claRear).toBeCloseTo(0.18, 9);
    expect(out.aero.cda - spec.aero.cda).toBeCloseTo(0.03, 9);
    expect(spec).toEqual(before);
  });

  it('AT3: brakeBias 0.55 and finalDrive 3.6 set brakes.bias to 0.55 and gearbox.final to 3.6', () => {
    const spec = f4Spec();
    const setup: Setup = { ...defaultSetup(spec), brakeBias: 0.55, finalDrive: 3.6 };
    const out = applySetup(spec, setup);
    expect(out.brakes.bias).toBeCloseTo(0.55, 9);
    expect(out.gearbox.final).toBeCloseTo(3.6, 9);
  });

  it('AT4: rideHeight -0.01 lowers every wheel hub y and chassis.cgHeight by 0.01', () => {
    const spec = f4Spec();
    const setup: Setup = { ...defaultSetup(spec), rideHeight: -0.01 };
    const out = applySetup(spec, setup);
    for (let i = 0; i < spec.wheels.positions.length; i++) {
      expect(out.wheels.positions[i][1]).toBeCloseTo(spec.wheels.positions[i][1] - 0.01, 9);
    }
    expect(out.chassis.cgHeight).toBeCloseTo(spec.chassis.cgHeight - 0.01, 9);
  });

  it('AT5: clampSetup clamps out-of-range values to [min,max] and rounds non-step values to the step from min', () => {
    const spec = f4Spec();
    const out = clampSetup(spec, {
      frontWing: 99,
      rearWing: -3,
      brakeBias: 0.45,
      finalDrive: 3.53,
      arbFront: 21500,
      arbRear: 50000,
      rideHeight: 0.013,
      tyrePressureKpa: 111,
    });
    expect(out.frontWing).toBe(10);
    expect(out.rearWing).toBe(0);
    expect(out.brakeBias).toBeCloseTo(0.5, 9);
    expect(out.finalDrive).toBeCloseTo(3.55, 9);
    expect(out.arbFront).toBe(22000);
    expect(out.arbRear).toBe(40000);
    expect(out.rideHeight).toBeCloseTo(0.014, 9);
    expect(out.tyrePressureKpa).toBe(120);
  });

  it('AT6: save then load round-trips for the same car+track; other track and corrupt JSON give the default', () => {
    const spec = f4Spec();
    const storage = new MapStorage();
    const saved: Setup = { ...defaultSetup(spec), rearWing: 8, brakeBias: 0.55, rideHeight: 0.004 };
    saveSetup('f4', 'monza', saved, storage);
    expect(JSON.parse(storage.getItem('setup:f4:monza') ?? 'null')).toEqual(saved);
    expect(loadSetup('f4', 'monza', spec, storage)).toEqual(saved);
    expect(loadSetup('f4', 'suzuka', spec, storage)).toEqual(defaultSetup(spec));
    storage.setItem('setup:f4:interlagos', '{oops');
    expect(loadSetup('f4', 'interlagos', spec, storage)).toEqual(defaultSetup(spec));
  });

  it("AT7: presetSetup('stable') equals spec.presets.stable", () => {
    const spec = f4Spec();
    expect(presetSetup(spec, 'stable')).toEqual(spec.presets.stable);
  });
});

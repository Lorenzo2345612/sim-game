import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { DriverInput } from '../../../src/core/types';
import type { Telemetry } from '../../../src/physics/vehicleModel';

const ROOT = join(__dirname, '..', '..', '..');

const HYBRID = {
  mgukW: 350000,
  batteryJ: 4e6,
  deployJPerLap: 8.5e6,
  harvestJPerLap: 8.5e6,
  overtakeExtraJ: 5e5,
  minSpeedMs: 50 / 3.6,
  taperStartMs: 290 / 3.6,
  taperEndMs: 345 / 3.6,
  overtakeTaperStartMs: 337 / 3.6,
  overtakeTaperEndMs: 355 / 3.6,
  regenW: 350000,
  superClipW: 350000,
  liftHarvestW: 100000,
};

const ACTIVE_AERO = { dragScale: 0.7, downforceScale: 0.6, transitionS: 0.4 };

type SpecWithHybrid = CarSpec & {
  hybrid?: typeof HYBRID;
  activeAero?: typeof ACTIVE_AERO;
};

function f4Json(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function headF4Json(): unknown {
  return JSON.parse(
    execFileSync('git', ['show', 'HEAD:public/cars/f4.json'], { cwd: ROOT, encoding: 'utf8' }),
  ) as unknown;
}

function withBlocks(): Record<string, unknown> {
  const json = f4Json();
  json.hybrid = { ...HYBRID };
  json.activeAero = { ...ACTIVE_AERO };
  return json;
}

describe('215 hybrid and active-aero contract acceptance', () => {
  it('AT1: f4.json parses with hybrid and activeAero undefined and other fields deep-equal to the HEAD snapshot parse', () => {
    const spec = parseCarSpec(f4Json()) as SpecWithHybrid;
    expect(spec.hybrid).toBeUndefined();
    expect(spec.activeAero).toBeUndefined();
    const { sound, ...current } = spec;
    void sound;
    const { sound: headSound, ...head } = parseCarSpec(headF4Json());
    void headSound;
    expect(current).toEqual(head);
  });

  it('AT2: hybrid block with the shared constants and activeAero {0.7, 0.6, 0.4} parse to deep-equal blocks', () => {
    const spec = parseCarSpec(withBlocks()) as SpecWithHybrid;
    expect(spec.hybrid).toEqual(HYBRID);
    expect(spec.activeAero).toEqual(ACTIVE_AERO);
  });

  it('AT3: missing mgukW, batteryJ 0, taperEndMs equal to taperStartMs, dragScale 1.2 and transitionS -1 throw with the field path', () => {
    const mutations: Array<{ apply: (json: Record<string, unknown>) => void; path: RegExp }> = [
      {
        apply: (json) => {
          delete (json.hybrid as Record<string, unknown>).mgukW;
        },
        path: /hybrid\.mgukW/,
      },
      {
        apply: (json) => {
          (json.hybrid as Record<string, unknown>).batteryJ = 0;
        },
        path: /hybrid\.batteryJ/,
      },
      {
        apply: (json) => {
          (json.hybrid as Record<string, unknown>).taperEndMs = HYBRID.taperStartMs;
        },
        path: /hybrid\.taperEndMs/,
      },
      {
        apply: (json) => {
          (json.activeAero as Record<string, unknown>).dragScale = 1.2;
        },
        path: /activeAero\.dragScale/,
      },
      {
        apply: (json) => {
          (json.activeAero as Record<string, unknown>).transitionS = -1;
        },
        path: /activeAero\.transitionS/,
      },
    ];
    for (const { apply, path } of mutations) {
      const json = withBlocks();
      apply(json);
      expect(() => parseCarSpec(json), path.source).toThrow(path);
    }
  });

  it('AT4: a DriverInput literal with only throttle/brake/steer/reset and a Telemetry literal without ers/aero compile', () => {
    const input: DriverInput = { throttle: 0.4, brake: 0, steer: -0.15, reset: false };
    const telemetry: Telemetry = { wheels: [], fuelKg: 50, rpm: 9000, gear: 4 };
    expect(input.reset).toBe(false);
    expect(telemetry.gear).toBe(4);
  });
});

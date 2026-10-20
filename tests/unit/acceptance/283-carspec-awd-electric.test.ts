import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { MotorSpec } from '../../../src/physics/electric';

const ROOT = join(__dirname, '..', '..', '..');
const CARS_DIR = join(ROOT, 'public', 'cars');

type CarSpec283 = Omit<CarSpec, 'drive'> & {
  drive: 'rwd' | 'awd';
  electric?: {
    front: MotorSpec;
    rear: MotorSpec;
    batteryJ: number;
    efficiency: number;
    modes: { race: number; attack: number };
    attack: { activations: number; durationS: number };
  };
};

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', name), 'utf8'));
}

describe('283 carSpec awd + electric acceptance', () => {
  it('AT1: existing cars parse unchanged with drive rwd and electric undefined', () => {
    const files = readdirSync(CARS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files).toContain('f4.json');
    expect(files).toContain('ow26.json');
    for (const f of files) {
      const spec: CarSpec283 = parseCarSpec(load(f));
      expect(spec.drive, f).toBe('rwd');
      expect(spec.electric, f).toBeUndefined();
    }
  });

  it('AT2: ow26 with drive awd and a valid electric block exposes rear 350000 W and attack mode 600000 W', () => {
    const json = {
      ...load('ow26.json'),
      drive: 'awd',
      electric: {
        front: { maxPowerW: 250000, maxTorqueNm: 400, maxRpm: 20000, ratio: 7.8, regenMaxW: 350000 },
        rear: { maxPowerW: 350000, maxTorqueNm: 557, maxRpm: 20000, ratio: 7.8, regenMaxW: 350000 },
        batteryJ: 184.5e6,
        efficiency: 0.95,
        modes: { race: 450000, attack: 600000 },
        attack: { activations: 2, durationS: 240 },
      },
    };
    const spec: CarSpec283 = parseCarSpec(json);
    expect(spec.electric).toBeDefined();
    expect(spec.electric?.rear.maxPowerW).toBe(350000);
    expect(spec.electric?.modes.attack).toBe(600000);
  });

  it('AT3: awd without electric, electric with rwd, negative front ratio and zero race mode throw naming the field', () => {
    const base = {
      ...load('ow26.json'),
      electric: {
        front: { maxPowerW: 250000, maxTorqueNm: 400, maxRpm: 20000, ratio: 7.8, regenMaxW: 350000 },
        rear: { maxPowerW: 350000, maxTorqueNm: 557, maxRpm: 20000, ratio: 7.8, regenMaxW: 350000 },
        batteryJ: 184.5e6,
        efficiency: 0.95,
        modes: { race: 450000, attack: 600000 },
        attack: { activations: 2, durationS: 240 },
      },
    };
    expect(() => parseCarSpec({ ...load('ow26.json'), drive: 'awd' })).toThrow(
      'Invalid car spec: electric is missing or invalid',
    );
    expect(() => parseCarSpec(base)).toThrow(
      'Invalid car spec: electric is missing or invalid',
    );
    expect(() =>
      parseCarSpec({
        ...base,
        drive: 'awd',
        electric: { ...base.electric, front: { ...base.electric.front, ratio: -1 } },
      }),
    ).toThrow('Invalid car spec: electric.front.ratio is missing or invalid');
    expect(() =>
      parseCarSpec({
        ...base,
        drive: 'awd',
        electric: { ...base.electric, modes: { ...base.electric.modes, race: 0 } },
      }),
    ).toThrow('Invalid car spec: electric.modes.race is missing or invalid');
  });
});

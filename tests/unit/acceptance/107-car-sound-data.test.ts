import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');

interface CarSoundShape {
  cylinders: number;
  exhaustLengthM: number;
  intakeMix: number;
  crackle: number;
}

function carJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', name), 'utf8')) as Record<
    string,
    unknown
  >;
}

function soundOf(json: unknown): CarSoundShape {
  return (parseCarSpec(json) as unknown as { sound: CarSoundShape }).sound;
}

describe('107 car sound data acceptance', () => {
  it('AT1: parseCarSpec of f4.json / gt3-a.json read sound — {4, 1.0, 0.35, 0.1} / {8, 1.4, 0.25, 0.5}', () => {
    const f4 = soundOf(carJson('f4.json'));
    expect(f4.cylinders).toBe(4);
    expect(f4.exhaustLengthM).toBeCloseTo(1.0, 9);
    expect(f4.intakeMix).toBeCloseTo(0.35, 9);
    expect(f4.crackle).toBeCloseTo(0.1, 9);
    const a = soundOf(carJson('gt3-a.json'));
    expect(a.cylinders).toBe(8);
    expect(a.exhaustLengthM).toBeCloseTo(1.4, 9);
    expect(a.intakeMix).toBeCloseTo(0.25, 9);
    expect(a.crackle).toBeCloseTo(0.5, 9);
  });

  it('AT2: a car JSON without sound — parseCarSpec — sound = {4, 1.2, 0.3, 0.2}', () => {
    const json = carJson('f4.json');
    delete json.sound;
    const sound = soundOf(json);
    expect(sound.cylinders).toBe(4);
    expect(sound.exhaustLengthM).toBeCloseTo(1.2, 9);
    expect(sound.intakeMix).toBeCloseTo(0.3, 9);
    expect(sound.crackle).toBeCloseTo(0.2, 9);
  });

  it('AT3: sound.cylinders 0, 13 or non-integer — parseCarSpec — throws (valid 1..12 integer)', () => {
    for (const cylinders of [0, 13, 1.5]) {
      const json = carJson('f4.json');
      json.sound = { cylinders };
      expect(() => parseCarSpec(json), `cylinders=${cylinders}`).toThrow(/sound\.cylinders/);
    }
  });
});

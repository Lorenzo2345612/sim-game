import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, DEFAULT_CAR_SOUND } from '../../../src/physics/carSpec';
import { legacySynthSpec } from '../../../src/audio/soundSpec';

const ROOT = join(__dirname, '..', '..', '..');

function f4(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function soundOf(json: unknown) {
  return parseCarSpec(json).sound;
}

function withSound(patch: Record<string, unknown>): unknown {
  const json = f4();
  json.sound = patch;
  return json;
}

describe('car sound spec', () => {
  it('absent block returns a copy of DEFAULT_CAR_SOUND', () => {
    const json = f4();
    delete json.sound;
    const sound = soundOf(json);
    expect(sound).toEqual({
      cylinders: 4,
      exhaustLengthM: 1.2,
      intakeMix: 0.3,
      crackle: 0.2,
      synth: legacySynthSpec({ cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 }),
    });
    expect(sound).toEqual(DEFAULT_CAR_SOUND);
    expect(sound).not.toBe(DEFAULT_CAR_SOUND);
    sound.crackle = 1;
    expect(DEFAULT_CAR_SOUND.crackle).toBe(0.2);
  });

  it('partial block takes the default for each missing field', () => {
    expect(soundOf(withSound({ cylinders: 8 }))).toEqual({
      cylinders: 8,
      exhaustLengthM: 1.2,
      intakeMix: 0.3,
      crackle: 0.2,
      synth: legacySynthSpec({ cylinders: 8, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 }),
    });
    expect(soundOf(withSound({ intakeMix: 0.9 }))).toEqual({
      cylinders: 4,
      exhaustLengthM: 1.2,
      intakeMix: 0.9,
      crackle: 0.2,
      synth: legacySynthSpec({ cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.9, crackle: 0.2 }),
    });
    expect(soundOf(withSound({}))).toEqual(DEFAULT_CAR_SOUND);
  });

  it('cylinders accepts integers 1..12 and rejects anything else', () => {
    expect(soundOf(withSound({ cylinders: 1 })).cylinders).toBe(1);
    expect(soundOf(withSound({ cylinders: 12 })).cylinders).toBe(12);
    for (const cylinders of [0, 13, 1.5, -4, NaN, Infinity]) {
      expect(() => soundOf(withSound({ cylinders })), `cylinders=${cylinders}`).toThrow(
        /sound\.cylinders/,
      );
    }
  });

  it('exhaustLengthM must be finite and in (0, 10]', () => {
    expect(soundOf(withSound({ exhaustLengthM: 10 })).exhaustLengthM).toBe(10);
    expect(soundOf(withSound({ exhaustLengthM: 0.01 })).exhaustLengthM).toBe(0.01);
    for (const exhaustLengthM of [0, -1, 10.5, NaN, Infinity]) {
      expect(
        () => soundOf(withSound({ exhaustLengthM })),
        `exhaustLengthM=${exhaustLengthM}`,
      ).toThrow(/sound\.exhaustLengthM/);
    }
  });

  it('intakeMix and crackle must be finite and in [0, 1]', () => {
    expect(soundOf(withSound({ intakeMix: 0 })).intakeMix).toBe(0);
    expect(soundOf(withSound({ crackle: 1 })).crackle).toBe(1);
    for (const intakeMix of [-0.01, 1.01, NaN, Infinity]) {
      expect(() => soundOf(withSound({ intakeMix })), `intakeMix=${intakeMix}`).toThrow(
        /sound\.intakeMix/,
      );
    }
    for (const crackle of [-0.01, 1.01, NaN, Infinity]) {
      expect(() => soundOf(withSound({ crackle })), `crackle=${crackle}`).toThrow(/sound\.crackle/);
    }
  });

  it('non-number field inside a present block throws', () => {
    expect(() => soundOf(withSound({ cylinders: '8' }))).toThrow(/sound\.cylinders/);
    expect(() => soundOf(withSound({ crackle: null }))).toThrow(/sound\.crackle/);
  });

  it('every car JSON carries its sound data', () => {
    const expected: Record<string, [number, number, number, number]> = {
      'f4.json': [4, 1.0, 0.35, 0.1],
      'gt3-a.json': [8, 1.4, 0.25, 0.5],
      'gt3-b.json': [6, 1.1, 0.3, 0.4],
      'gt3-c.json': [8, 1.5, 0.2, 0.6],
      'gt3-d.json': [8, 1.4, 0.25, 0.5],
    };
    for (const [file, [cylinders, exhaustLengthM, intakeMix, crackle]] of Object.entries(expected)) {
      const json = JSON.parse(
        readFileSync(join(ROOT, 'public', 'cars', file), 'utf8'),
      ) as unknown;
      expect(soundOf(json), file).toEqual({
        cylinders,
        exhaustLengthM,
        intakeMix,
        crackle,
        synth: legacySynthSpec({ cylinders, exhaustLengthM, intakeMix, crackle }),
      });
    }
  });
});

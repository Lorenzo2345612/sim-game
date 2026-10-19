import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';
import {
  evenFiring,
  legacySynthSpec,
  parseEngineSynth,
  SYNTH_DEFAULTS,
} from '../../../src/audio/soundSpec';

const ROOT = join(__dirname, '..', '..', '..');
const LEGACY = { cylinders: 4, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };

const FULL_RAW = {
  kind: 'combustion' as const,
  firingDeg: [0, 90, 180, 270],
  bank: [1, 0, 1, 0],
  pipeM: [1.5, 2.5],
  tailM: 2,
  gasSpeedMs: 550,
  pulseDeg: 150,
  jitterDeg: 1,
  jitterAmp: 0.2,
  intakeHz: 500,
  intakeMix: 0.8,
  block: [{ hz: 1000, q: 10, gainDb: 6 }],
  lowpassHz: 9000,
  drive: 2.5,
  turbo: { centerHz: 4000, spanHz: 2000, gain: 0.1, lagS: 0.5 },
  whine: { order: 20, gain: 0.1, source: 'rpm', minSpeedMs: 5 },
  electric: null,
  crackle: 0.7,
  limiterHz: 30,
  gainDb: -6,
  cylVar: 0.2,
  bassDb: 4,
  exhaustGain: 0.8,
};

const BLOCK7 = [
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
  { hz: 900, q: 8, gainDb: 6 },
];

const ERROR_CASES: Array<{ raw: Record<string, unknown>; needle: string }> = [
  { raw: { firingDeg: [0, 720], bank: [0, 1] }, needle: 'synth.firingDeg' },
  { raw: { firingDeg: [0, 180, 360, 540], bank: [0, 1] }, needle: 'synth.bank' },
  {
    raw: { firingDeg: [0, 180, 360, 540], bank: [0, 1, 0, 1], pipeM: [0, 1] },
    needle: 'synth.pipeM',
  },
  { raw: { block: BLOCK7 }, needle: 'synth.block' },
  { raw: { whine: { order: 20, gain: 0.1, source: 'x', minSpeedMs: 5 } }, needle: 'synth.whine' },
  { raw: { turbo: { centerHz: 3000, spanHz: 3000, gain: 0.5, lagS: 0.4 } }, needle: 'synth.turbo' },
];

function carJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', name), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('226 engine sound spec acceptance', () => {
  it('AT1: evenFiring(8) is [0,90,180,270,360,450,540,630] and evenFiring(6) is [0,120,240,360,480,600]', () => {
    expect(evenFiring(8)).toEqual([0, 90, 180, 270, 360, 450, 540, 630]);
    expect(evenFiring(6)).toEqual([0, 120, 240, 360, 480, 600]);
  });

  it('AT2: legacySynthSpec maps the 4-cyl legacy fields and every other field equals SYNTH_DEFAULTS', () => {
    const spec = legacySynthSpec({
      cylinders: 4,
      exhaustLengthM: 1.0,
      intakeMix: 0.35,
      crackle: 0.1,
    });
    expect(spec).toEqual({
      ...SYNTH_DEFAULTS,
      firingDeg: [0, 180, 360, 540],
      bank: [0, 1, 0, 1],
      pipeM: [0.5, 0.5],
      tailM: 0.5,
      intakeMix: 0.35,
      crackle: 0.1,
    });
  });

  it('AT3: a full valid raw with non-default in-range values parses with no errors and deep-equals the input', () => {
    const { spec, errors } = parseEngineSynth(FULL_RAW, LEGACY);
    expect(errors).toEqual([]);
    expect(spec).toEqual(FULL_RAW);
  });

  it('AT4: raw {} with a 6-cyl legacy returns the legacy spec and SYNTH_DEFAULTS holds the documented defaults', () => {
    const legacy = { cylinders: 6, exhaustLengthM: 1.2, intakeMix: 0.3, crackle: 0.2 };
    const { spec, errors } = parseEngineSynth({}, legacy);
    expect(errors).toEqual([]);
    expect(spec).toEqual(legacySynthSpec(legacy));
    expect(SYNTH_DEFAULTS.gasSpeedMs).toBe(480);
    expect(SYNTH_DEFAULTS.pulseDeg).toBe(110);
    expect(SYNTH_DEFAULTS.jitterDeg).toBe(0.2);
    expect(SYNTH_DEFAULTS.jitterAmp).toBe(0.05);
    expect(SYNTH_DEFAULTS.intakeHz).toBe(300);
    expect(SYNTH_DEFAULTS.block).toEqual([]);
    expect(SYNTH_DEFAULTS.lowpassHz).toBe(6000);
    expect(SYNTH_DEFAULTS.drive).toBe(1.2);
    expect(SYNTH_DEFAULTS.turbo).toBeNull();
    expect(SYNTH_DEFAULTS.whine).toBeNull();
    expect(SYNTH_DEFAULTS.limiterHz).toBe(15);
    expect(SYNTH_DEFAULTS.gainDb).toBe(0);
  });

  it('AT5: invalid firingDeg/bank/pipeM/block/whine/turbo raws never throw and each reports its synth.<field> error', () => {
    for (const { raw, needle } of ERROR_CASES) {
      expect(() => parseEngineSynth(raw, LEGACY), needle).not.toThrow();
      const { errors } = parseEngineSynth(raw, LEGACY);
      expect(
        errors.some((e: string) => e.includes(needle)),
        `${needle}: ${errors.join(' | ')}`,
      ).toBe(true);
    }
  });

  it('AT6: every public/cars/*.json except index.json parses without throwing and synth.firingDeg.length equals cylinders', () => {
    const dir = join(ROOT, 'public', 'cars');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
      const spec = parseCarSpec(json);
      const sound = spec.sound as unknown as {
        cylinders: number;
        synth: { firingDeg: number[] };
      };
      expect(sound.synth.firingDeg.length, file).toBe(sound.cylinders);
    }
  });

  it('AT7: a valid car json with sound.synth.firingDeg [0, 800] — parseCarSpec — throws with sound.synth.firingDeg', () => {
    const json = carJson('f4.json');
    const sound = (json.sound ?? {}) as Record<string, unknown>;
    sound.synth = { firingDeg: [0, 800] };
    json.sound = sound;
    expect(() => parseCarSpec(json)).toThrow(/sound\.synth\.firingDeg/);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { evenFiring, parseEngineSynth } from '../../../src/audio/soundSpec';

const CARS_DIR = join(__dirname, '..', '..', '..', 'public', 'cars');
const CAR_IDS = ['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'gt3-d', 'lmp2-a', 'hyper-a', 'ow26'];

function carJson(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(CARS_DIR, `${id}.json`), 'utf8')) as Record<string, unknown>;
}

function synthOf(id: string) {
  const json = carJson(id);
  const sound = json['sound'] as Record<string, unknown>;
  return parseEngineSynth(sound['synth'], {
    cylinders: sound['cylinders'] as number,
    exhaustLengthM: sound['exhaustLengthM'] as number,
    intakeMix: sound['intakeMix'] as number,
    crackle: sound['crackle'] as number,
  });
}

describe('231 per-car engine synth data acceptance', () => {
  it('AT1: every public/cars/*.json except index has sound.synth and parseEngineSynth reports no errors', () => {
    const files = readdirSync(CARS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
    expect(files.length).toBe(CAR_IDS.length);
    for (const file of files) {
      const json = JSON.parse(readFileSync(join(CARS_DIR, file), 'utf8')) as Record<string, unknown>;
      const sound = json['sound'] as Record<string, unknown>;
      expect(sound['synth'], file).toBeDefined();
      const { errors } = parseEngineSynth(sound['synth'], {
        cylinders: sound['cylinders'] as number,
        exhaustLengthM: sound['exhaustLengthM'] as number,
        intakeMix: sound['intakeMix'] as number,
        crackle: sound['crackle'] as number,
      });
      expect(errors, file).toEqual([]);
    }
  });

  it('AT2: f4 / gt3-b / gt3-c / lmp2-a / hyper-a firingDeg is evenFiring(4) / evenFiring(6) / evenFiring(8) / evenFiring(8) / evenFiring(8)', () => {
    expect(synthOf('f4').spec.firingDeg).toEqual(evenFiring(4));
    expect(synthOf('gt3-b').spec.firingDeg).toEqual(evenFiring(6));
    expect(synthOf('gt3-c').spec.firingDeg).toEqual(evenFiring(8));
    expect(synthOf('lmp2-a').spec.firingDeg).toEqual(evenFiring(8));
    expect(synthOf('hyper-a').spec.firingDeg).toEqual(evenFiring(8));
  });

  it('AT3: gt3-a firingDeg is evenFiring(8) with cross-plane bank [0,1,0,0,1,1,1,0]', () => {
    const spec = synthOf('gt3-a').spec;
    expect(spec.firingDeg).toEqual(evenFiring(8));
    expect(spec.bank).toEqual([0, 1, 0, 0, 1, 1, 1, 0]);
  });

  it('AT4: gt3-d firingDeg has 10 values starting at 0 with consecutive intervals alternating 90 and 54 (±0.5)', () => {
    const firingDeg = synthOf('gt3-d').spec.firingDeg;
    expect(firingDeg.length).toBe(10);
    expect(firingDeg[0]).toBe(0);
    for (let i = 1; i < firingDeg.length; i++) {
      const interval = firingDeg[i] - firingDeg[i - 1];
      const expected = i % 2 === 1 ? 90 : 54;
      expect(Math.abs(interval - expected)).toBeLessThanOrEqual(0.5);
    }
  });

  it('AT5: ow26 firingDeg is [0,90,240,330,480,570]', () => {
    expect(synthOf('ow26').spec.firingDeg).toEqual([0, 90, 240, 330, 480, 570]);
  });

  it('AT6: turbo non-null exactly for f4, hyper-a, ow26; whine is rpm for ow26, wheel for hyper-a, null otherwise', () => {
    for (const id of CAR_IDS) {
      const spec = synthOf(id).spec;
      const expectTurbo = id === 'f4' || id === 'hyper-a' || id === 'ow26';
      expect(spec.turbo !== null, `${id} turbo`).toBe(expectTurbo);
      if (id === 'ow26') expect(spec.whine?.source, id).toBe('rpm');
      else if (id === 'hyper-a') expect(spec.whine?.source, id).toBe('wheel');
      else expect(spec.whine, id).toBeNull();
    }
  });

  it('AT7: no two sound.synth objects are deep-equal', () => {
    const specs = CAR_IDS.map((id) => synthOf(id).spec);
    for (let i = 0; i < specs.length; i++) {
      for (let j = i + 1; j < specs.length; j++) {
        expect(specs[i], `${CAR_IDS[i]} vs ${CAR_IDS[j]}`).not.toEqual(specs[j]);
      }
    }
  });
});

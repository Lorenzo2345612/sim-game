import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { CAR_IDS } from '../../../src/ui/menu';

const ROOT = join(__dirname, '..', '..', '..');

function loadSpec(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

function readCarsIndex(): { id: string; name: string; category: string }[] {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'index.json'), 'utf8')) as {
    id: string;
    name: string;
    category: string;
  }[];
}

describe('221 OW-26 edge', () => {
  it('EDGE1: CAR_IDS accepts ow26 so ?car=ow26 does not fall back to the default car', () => {
    expect(CAR_IDS).toContain('ow26');
  });

  it('EDGE2: cars index registers ow26 exactly once, as the last entry', () => {
    const entries = readCarsIndex();
    expect(entries.filter((e) => e.id === 'ow26')).toHaveLength(1);
    expect(entries[entries.length - 1].id).toBe('ow26');
  });

  it('EDGE3: ow26.json game data text contains no "F1" or "Formula"', () => {
    const text = readFileSync(join(ROOT, 'public', 'cars', 'ow26.json'), 'utf8');
    expect(/f1|formula/i.test(text)).toBe(false);
  });

  it('EDGE4: hybrid equals the shared constants of 215', () => {
    const h = loadSpec().hybrid;
    expect(h?.mgukW).toBeCloseTo(350000, 9);
    expect(h?.batteryJ).toBeCloseTo(4e6, 9);
    expect(h?.deployJPerLap).toBeCloseTo(8.5e6, 9);
    expect(h?.harvestJPerLap).toBeCloseTo(8.5e6, 9);
    expect(h?.overtakeExtraJ).toBeCloseTo(5e5, 9);
    expect(h?.minSpeedMs).toBeCloseTo(50 / 3.6, 9);
    expect(h?.taperStartMs).toBeCloseTo(290 / 3.6, 9);
    expect(h?.taperEndMs).toBeCloseTo(345 / 3.6, 9);
    expect(h?.overtakeTaperStartMs).toBeCloseTo(337 / 3.6, 9);
    expect(h?.overtakeTaperEndMs).toBeCloseTo(355 / 3.6, 9);
    expect(h?.regenW).toBeCloseTo(350000, 9);
    expect(h?.superClipW).toBeCloseTo(350000, 9);
    expect(h?.liftHarvestW).toBeCloseTo(100000, 9);
  });

  it('EDGE5: activeAero is dragScale 0.7, downforceScale 0.6, transitionS 0.4', () => {
    const a = loadSpec().activeAero;
    expect(a?.dragScale).toBeCloseTo(0.7, 9);
    expect(a?.downforceScale).toBeCloseTo(0.6, 9);
    expect(a?.transitionS).toBeCloseTo(0.4, 9);
  });

  it('EDGE6: the differential is an LSD', () => {
    expect(loadSpec().diff.type).toBe('lsd');
  });

  it('EDGE7: id is ow26 and name is OW-26 Hybrid', () => {
    const spec = loadSpec();
    expect(spec.id).toBe('ow26');
    expect(spec.name).toBe('OW-26 Hybrid');
  });

  it('EDGE8: model.url is the /models/f4.glb placeholder', () => {
    expect(loadSpec().model.url).toBe('/models/f4.glb');
  });

  it('EDGE9: setup ranges are well-formed and every preset value lies inside its range', () => {
    const spec = loadSpec();
    const knobs = Object.keys(spec.setup) as (keyof typeof spec.setup)[];
    for (const knob of knobs) {
      const r = spec.setup[knob];
      expect(r.min, knob).toBeLessThan(r.max);
      expect(r.step, knob).toBeGreaterThan(0);
      expect(r.default, knob).toBeGreaterThanOrEqual(r.min);
      expect(r.default, knob).toBeLessThanOrEqual(r.max);
    }
    for (const [pname, preset] of Object.entries(spec.presets)) {
      for (const knob of knobs) {
        const v = preset[knob];
        const r = spec.setup[knob];
        expect(v, `${pname}.${knob}`).toBeGreaterThanOrEqual(r.min);
        expect(v, `${pname}.${knob}`).toBeLessThanOrEqual(r.max);
      }
    }
  });

  it('EDGE10: sound.cylinders is 6', () => {
    expect(loadSpec().sound.cylinders).toBe(6);
  });
});

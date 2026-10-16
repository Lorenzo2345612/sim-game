import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec, type TyreCompound } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const CAR_IDS = ['gt3-a', 'gt3-b', 'gt3-c', 'gt3-d', 'lmp2-a', 'hyper-a'] as const;
const EQ_FIELDS = [
  'Fz0',
  'loadSens',
  'Bx',
  'Cx',
  'Ex',
  'By',
  'Cy',
  'Ey',
  'tempWindowC',
  'heatCoef',
  'coolCoef',
  'wearGripLoss',
  'cliffWear',
] as const;
const MU0_TOL = 1e-6;
const WEAR_TOL = 1e-15;
const MEDIUM_MU0: Record<(typeof CAR_IDS)[number], number> = {
  'gt3-a': 1.55,
  'gt3-b': 1.55,
  'gt3-c': 1.55,
  'gt3-d': 1.55,
  'lmp2-a': 1.8,
  'hyper-a': 1.75,
};
const EXPECTED_MU0: Record<(typeof CAR_IDS)[number], { soft: number; hard: number }> = {
  'gt3-a': { soft: 1.643, hard: 1.4725 },
  'gt3-b': { soft: 1.643, hard: 1.4725 },
  'gt3-c': { soft: 1.643, hard: 1.4725 },
  'gt3-d': { soft: 1.643, hard: 1.4725 },
  'lmp2-a': { soft: 1.908, hard: 1.71 },
  'hyper-a': { soft: 1.855, hard: 1.6625 },
};

function carSpec(id: string): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8')) as unknown;
  return parseCarSpec(json);
}

function compounds(id: string): Record<'soft' | 'medium' | 'hard', TyreCompound> {
  return carSpec(id).tyres.compounds;
}

describe('213 compound consistency acceptance', () => {
  it('AT1: soft/medium/hard mu0 follow medium × 1.06 / × 0.95 with soft > medium > hard', () => {
    for (const id of CAR_IDS) {
      const { soft, medium, hard } = compounds(id);
      expect(Math.abs(soft.mu0 - medium.mu0 * 1.06), `${id} soft mu0`).toBeLessThanOrEqual(MU0_TOL);
      expect(Math.abs(hard.mu0 - medium.mu0 * 0.95), `${id} hard mu0`).toBeLessThanOrEqual(MU0_TOL);
      expect(soft.mu0, `${id} soft > medium`).toBeGreaterThan(medium.mu0);
      expect(medium.mu0, `${id} medium > hard`).toBeGreaterThan(hard.mu0);
    }
  });

  it('AT2: every soft/hard field except mu0, optTempC and wearRate equals medium', () => {
    for (const id of CAR_IDS) {
      const { soft, medium, hard } = compounds(id);
      for (const f of EQ_FIELDS) {
        expect(soft[f], `${id} soft ${f}`).toBeCloseTo(medium[f], 12);
        expect(hard[f], `${id} hard ${f}`).toBeCloseTo(medium[f], 12);
      }
    }
  });

  it('AT3: optTempC soft 85 / hard 95 and wearRate 2× / 0.46× medium', () => {
    for (const id of CAR_IDS) {
      const { soft, medium, hard } = compounds(id);
      expect(soft.optTempC, `${id} soft optTempC`).toBeCloseTo(85, 6);
      expect(hard.optTempC, `${id} hard optTempC`).toBeCloseTo(95, 6);
      expect(Math.abs(soft.wearRate - 2 * medium.wearRate), `${id} soft wearRate`).toBeLessThanOrEqual(WEAR_TOL);
      expect(Math.abs(hard.wearRate - 0.46 * medium.wearRate), `${id} hard wearRate`).toBeLessThanOrEqual(WEAR_TOL);
    }
  });

  it('AT4: mu0 values are gt3 1.643/1.4725, lmp2 1.908/1.71, hyper 1.855/1.6625 and medium unchanged', () => {
    for (const id of CAR_IDS) {
      const { soft, medium, hard } = compounds(id);
      const exp = EXPECTED_MU0[id];
      expect(Math.abs(soft.mu0 - exp.soft), `${id} soft mu0`).toBeLessThanOrEqual(MU0_TOL);
      expect(Math.abs(hard.mu0 - exp.hard), `${id} hard mu0`).toBeLessThanOrEqual(MU0_TOL);
      expect(Math.abs(medium.mu0 - MEDIUM_MU0[id]), `${id} medium mu0`).toBeLessThanOrEqual(MU0_TOL);
    }
  });

  it('AT5: f4.json compounds unchanged — soft 1.81896, medium 1.716, hard 1.6302', () => {
    const { soft, medium, hard } = compounds('f4');
    expect(Math.abs(soft.mu0 - 1.81896), 'f4 soft mu0').toBeLessThanOrEqual(MU0_TOL);
    expect(Math.abs(medium.mu0 - 1.716), 'f4 medium mu0').toBeLessThanOrEqual(MU0_TOL);
    expect(Math.abs(hard.mu0 - 1.6302), 'f4 hard mu0').toBeLessThanOrEqual(MU0_TOL);
  });
});

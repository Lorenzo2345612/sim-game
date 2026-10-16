import { describe, it, expect } from 'vitest';
import { Ers } from '../../../src/physics/ers';
import type { HybridSpec } from '../../../src/physics/hybridTypes';

const DT = 1 / 120;

const SPEC: HybridSpec = {
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

describe('216 ERS energy model edge cases', () => {
  it('EDGE1: dt <= 0 returns 0, mutates no energy state and clears the last-step results', () => {
    const ers = new Ers(SPEC);
    ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    const soc = ers.socJ;
    expect(ers.overtakeActive).toBe(true);
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, 0)).toBeCloseTo(0, 9);
    expect(ers.socJ).toBeCloseTo(soc, 9);
    expect(ers.lapDeployJ).toBeCloseTo(350000 / 120, 9);
    expect(ers.powerW).toBeCloseTo(0, 9);
    expect(ers.clipping).toBe(false);
    expect(ers.overtakeActive).toBe(false);
    expect(ers.overtakeUsedThisLap).toBe(true);
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, -DT)).toBeCloseTo(0, 9);
    expect(ers.socJ).toBeCloseTo(soc, 9);
  });

  it('EDGE2: non-finite speed, throttle or brake return 0 and leave every counter unchanged', () => {
    const cases = [
      { speedMs: NaN, throttle: 1, brake: 0, overtake: false },
      { speedMs: Infinity, throttle: 1, brake: 0, overtake: false },
      { speedMs: 50, throttle: NaN, brake: 0, overtake: false },
      { speedMs: 50, throttle: 0, brake: Infinity, overtake: false },
      { speedMs: 50, throttle: 1, brake: NaN, overtake: false },
    ];
    for (const input of cases) {
      const ers = new Ers(SPEC);
      ers.socJ = 2e6;
      expect(ers.step(input, DT)).toBeCloseTo(0, 9);
      expect(ers.socJ).toBeCloseTo(2e6, 9);
      expect(ers.lapDeployJ).toBeCloseTo(0, 9);
      expect(ers.lapHarvestJ).toBeCloseTo(0, 9);
      expect(ers.clipping).toBe(false);
      expect(ers.overtakeUsedThisLap).toBe(false);
    }
  });

  it('EDGE3: a brake of exactly 0.05 harvests, a throttle of exactly 0.05 deploys, below it lifts', () => {
    const a = new Ers(SPEC);
    a.socJ = 2e6;
    expect(a.step({ speedMs: 50, throttle: 1, brake: 0.05, overtake: false }, DT)).toBeCloseTo(-35000, 6);
    expect(a.clipping).toBe(false);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: 50, throttle: 0.05, brake: 0, overtake: false }, DT)).toBeCloseTo(14000, 6);
    expect(b.clipping).toBe(false);
    const c = new Ers(SPEC);
    c.socJ = 2e6;
    expect(c.step({ speedMs: 50, throttle: 0.049, brake: 0, overtake: false }, DT)).toBeCloseTo(-100000, 6);
    expect(c.clipping).toBe(false);
  });

  it('EDGE4: super-clipping arms only at throttle >= 0.95 when deploy power is zero', () => {
    const a = new Ers(SPEC);
    a.socJ = 2e6;
    expect(a.step({ speedMs: 96, throttle: 0.95, brake: 0, overtake: false }, DT)).toBeCloseTo(-175000, 6);
    expect(a.clipping).toBe(true);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: 96, throttle: 0.94, brake: 0, overtake: false }, DT)).toBeCloseTo(0, 9);
    expect(b.clipping).toBe(false);
    expect(b.socJ).toBeCloseTo(2e6, 9);
  });

  it('EDGE5: socFrac tracks the battery and deployCapJ follows overtake use within the lap', () => {
    const ers = new Ers(SPEC);
    expect(ers.socFrac).toBeCloseTo(1, 12);
    expect(ers.deployCapJ).toBeCloseTo(8.5e6, 6);
    ers.setMode('attack');
    ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    expect(ers.socFrac).toBeCloseTo(1 - 350000 / (120 * 4e6), 9);
    expect(ers.deployCapJ).toBeCloseTo(9e6, 6);
    ers.newLap();
    expect(ers.deployCapJ).toBeCloseTo(8.5e6, 6);
    expect(ers.socFrac).toBeCloseTo(1 - 350000 / (120 * 4e6), 9);
  });

  it('EDGE6: charge blocks deploy at exactly the taper start and allows it just below', () => {
    const a = new Ers(SPEC);
    a.setMode('charge');
    a.socJ = 2e6;
    expect(a.step({ speedMs: 290 / 3.6, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(-350000, 6);
    expect(a.clipping).toBe(true);
    const b = new Ers(SPEC);
    b.setMode('charge');
    b.socJ = 2e6;
    expect(b.step({ speedMs: 290 / 3.6 - 0.01, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(175000, 6);
    expect(b.clipping).toBe(false);
  });

  it('EDGE7: overtake bypasses the charge block and the mode deploy factor', () => {
    const charge = new Ers(SPEC);
    charge.setMode('charge');
    charge.socJ = 2e6;
    expect(charge.step({ speedMs: 345 / 3.6, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(-350000, 6);
    const p = charge.step({ speedMs: 345 / 3.6, throttle: 1, brake: 0, overtake: true }, DT);
    expect(Math.abs(p - (350000 * (355 - 345)) / (355 - 337))).toBeLessThanOrEqual(0.01);
    expect(charge.overtakeActive).toBe(true);
    const balance = new Ers(SPEC);
    expect(balance.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT)).toBeCloseTo(350000, 6);
    expect(balance.overtakeActive).toBe(true);
    expect(balance.deployCapJ).toBeCloseTo(9e6, 6);
  });

  it('EDGE8: overtake never suppresses harvest and still arms the lap flags', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    ers.socJ = 2e6;
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 1, overtake: true }, DT)).toBeCloseTo(-350000, 6);
    expect(ers.clipping).toBe(false);
    expect(ers.overtakeActive).toBe(true);
    expect(ers.overtakeUsedThisLap).toBe(true);
    expect(ers.deployCapJ).toBeCloseTo(9e6, 6);
    expect(ers.step({ speedMs: 50, throttle: 0, brake: 0, overtake: true }, DT)).toBeCloseTo(-100000, 6);
    expect(ers.clipping).toBe(false);
    expect(ers.overtakeActive).toBe(true);
  });

  it('EDGE9: a super-clip against a full battery is capped to zero power without the clipping flag', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 4e6;
    expect(ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(0, 9);
    expect(ers.clipping).toBe(false);
    expect(ers.socJ).toBeCloseTo(4e6, 9);
    expect(ers.lapHarvestJ).toBeCloseTo(0, 9);
  });

  it('EDGE10: overtakeActive clears on the next non-overtake step while the lap cap persists until newLap', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT)).toBeCloseTo(350000, 6);
    expect(ers.overtakeActive).toBe(true);
    expect(ers.deployCapJ).toBeCloseTo(9e6, 6);
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(350000, 6);
    expect(ers.overtakeActive).toBe(false);
    expect(ers.overtakeUsedThisLap).toBe(true);
    expect(ers.deployCapJ).toBeCloseTo(9e6, 6);
    expect(ers.lapDeployJ).toBeCloseTo((2 * 350000) / 120, 6);
    ers.newLap();
    expect(ers.overtakeUsedThisLap).toBe(false);
    expect(ers.deployCapJ).toBeCloseTo(8.5e6, 6);
    expect(ers.lapDeployJ).toBeCloseTo(0, 9);
    expect(ers.socJ).toBeCloseTo(4e6 - (2 * 350000) / 120, 6);
  });
});

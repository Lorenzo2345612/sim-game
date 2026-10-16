import { describe, it, expect } from 'vitest';
import { ERS_MODE_FACTORS, Ers, type ErsInput } from '../../../src/physics/ers';
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

describe('216 ERS post-code gaps', () => {
  it('ERS_MODE_FACTORS exports the per-mode deploy and clip factors', () => {
    expect(ERS_MODE_FACTORS).toEqual({
      charge: { deploy: 0.5, clip: 1 },
      balance: { deploy: 0.8, clip: 0.5 },
      attack: { deploy: 1, clip: 0 },
    });
  });

  it('exactly minSpeedMs deploys; one ulp below it returns 0 and keeps soc', () => {
    const a = new Ers(SPEC);
    expect(a.step({ speedMs: SPEC.minSpeedMs, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(280000, 6);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: SPEC.minSpeedMs - 1e-9, throttle: 1, brake: 0, overtake: false }, DT)).toBe(0);
    expect(b.socJ).toBe(2e6);
  });

  it('zero and negative speeds return 0 and keep every counter', () => {
    for (const speedMs of [0, -20]) {
      const ers = new Ers(SPEC);
      ers.socJ = 2e6;
      expect(ers.step({ speedMs, throttle: 1, brake: 1, overtake: false }, DT)).toBe(0);
      expect(ers.socJ).toBe(2e6);
      expect(ers.lapDeployJ).toBe(0);
      expect(ers.lapHarvestJ).toBe(0);
    }
  });

  it('non-finite, infinite-sign or undefined dt return 0 without mutating state', () => {
    const ers = new Ers(SPEC);
    ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    const soc = ers.socJ;
    const deploy = ers.lapDeployJ;
    for (const dt of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, dt)).toBe(0);
      expect(ers.socJ).toBe(soc);
      expect(ers.lapDeployJ).toBe(deploy);
      expect(ers.powerW).toBe(0);
      expect(ers.overtakeActive).toBe(false);
    }
  });

  it('missing input fields return 0 without mutating state', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 2e6;
    expect(ers.step({} as unknown as ErsInput, DT)).toBe(0);
    expect(ers.step({ speedMs: 50 } as unknown as ErsInput, DT)).toBe(0);
    expect(ers.step({ speedMs: 50, throttle: 1 } as unknown as ErsInput, DT)).toBe(0);
    expect(ers.socJ).toBe(2e6);
    expect(ers.powerW).toBe(0);
  });

  it('regen saturates at brake 0.5 and above', () => {
    const a = new Ers(SPEC);
    a.socJ = 2e6;
    expect(a.step({ speedMs: 50, throttle: 0, brake: 0.49, overtake: false }, DT)).toBeCloseTo(-343000, 3);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: 50, throttle: 0, brake: 0.5, overtake: false }, DT)).toBeCloseTo(-350000, 6);
    const c = new Ers(SPEC);
    c.socJ = 2e6;
    expect(c.step({ speedMs: 50, throttle: 0, brake: 5, overtake: false }, DT)).toBeCloseTo(-350000, 6);
  });

  it('brake below the harvest threshold is ignored and does not block deploy or lift', () => {
    const a = new Ers(SPEC);
    a.setMode('attack');
    expect(a.step({ speedMs: 50, throttle: 1, brake: 0.049, overtake: false }, DT)).toBeCloseTo(350000, 6);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: 50, throttle: 0.04, brake: 0.049, overtake: false }, DT)).toBeCloseTo(-100000, 6);
  });

  it('negative throttle and brake act as below-threshold inputs', () => {
    const a = new Ers(SPEC);
    a.socJ = 2e6;
    expect(a.step({ speedMs: 50, throttle: -1, brake: -1, overtake: false }, DT)).toBeCloseTo(-100000, 6);
    const b = new Ers(SPEC);
    b.setMode('attack');
    expect(b.step({ speedMs: 50, throttle: 1, brake: -1, overtake: false }, DT)).toBeCloseTo(350000, 6);
  });

  it('throttle above 1 scales deploy linearly with no input clamp', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    expect(ers.step({ speedMs: 50, throttle: 2, brake: 0, overtake: false }, DT)).toBeCloseTo(700000, 6);
  });

  it('an exhausted lap deploy cap turns full throttle into a balance-mode super-clip', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 2e6;
    ers.lapDeployJ = 8.5e6;
    const p = ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p).toBeCloseTo(-175000, 6);
    expect(ers.clipping).toBe(true);
    expect(ers.lapDeployJ).toBe(8.5e6);
    expect(ers.lapHarvestJ).toBeCloseTo(175000 / 120, 6);
    expect(ers.socJ).toBeCloseTo(2e6 + 175000 / 120, 6);
  });

  it('a super-clip capped by battery headroom stays positive and keeps clipping true', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 4e6 - 100;
    const p = ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p).toBeCloseTo(-12000, 6);
    expect(ers.clipping).toBe(true);
    expect(ers.socJ).toBeCloseTo(4e6, 6);
  });

  it('a super-clip capped by the lap harvest budget stays positive and keeps clipping true', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 2e6;
    ers.lapHarvestJ = 8.5e6 - 50;
    const p = ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p).toBeCloseTo(-6000, 6);
    expect(ers.clipping).toBe(true);
    expect(ers.lapHarvestJ).toBeCloseTo(8.5e6, 6);
  });

  it('regen capped by battery headroom is positive without the clipping flag', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 4e6 - 100;
    const p = ers.step({ speedMs: 50, throttle: 0, brake: 1, overtake: false }, DT);
    expect(p).toBeCloseTo(-12000, 6);
    expect(ers.clipping).toBe(false);
    expect(ers.socJ).toBeCloseTo(4e6, 6);
  });

  it('a large dt drains deploy soc to exactly zero and fills harvest to batteryJ', () => {
    const a = new Ers(SPEC);
    a.setMode('attack');
    a.socJ = 1000;
    expect(a.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, 10)).toBeCloseTo(100, 6);
    expect(a.socJ).toBeCloseTo(0, 9);
    expect(a.lapDeployJ).toBeCloseTo(1000, 6);
    const b = new Ers(SPEC);
    b.socJ = 2e6;
    expect(b.step({ speedMs: 50, throttle: 0, brake: 1, overtake: false }, 100)).toBeCloseTo(-20000, 6);
    expect(b.socJ).toBeCloseTo(4e6, 9);
    expect(b.clipping).toBe(false);
  });

  it('a tiny positive soc still arms overtake with soc-limited power', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    ers.socJ = 1e-3;
    const p = ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    expect(p).toBeCloseTo(0.12, 6);
    expect(ers.overtakeActive).toBe(true);
    expect(ers.overtakeUsedThisLap).toBe(true);
    expect(ers.socJ).toBeGreaterThanOrEqual(0);
    expect(ers.socJ).toBeLessThan(1e-12);
  });

  it('reset after real overtake and clip steps clears results and flags and keeps the mode', () => {
    const ers = new Ers(SPEC);
    ers.setMode('charge');
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT)).toBeCloseTo(350000, 6);
    expect(ers.overtakeUsedThisLap).toBe(true);
    ers.socJ = 2e6;
    expect(ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(-350000, 6);
    expect(ers.clipping).toBe(true);
    ers.reset();
    expect(ers.mode).toBe('charge');
    expect(ers.socJ).toBe(4e6);
    expect(ers.lapDeployJ).toBe(0);
    expect(ers.lapHarvestJ).toBe(0);
    expect(ers.overtakeUsedThisLap).toBe(false);
    expect(ers.overtakeActive).toBe(false);
    expect(ers.powerW).toBe(0);
    expect(ers.clipping).toBe(false);
    expect(ers.deployCapJ).toBe(8.5e6);
  });

  it('the spec object is never mutated by construction or stepping', () => {
    const spec = Object.freeze({ ...SPEC });
    const ers = new Ers(spec);
    ers.setMode('attack');
    ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT);
    ers.newLap();
    ers.reset();
    expect(spec).toEqual(SPEC);
  });

  it('a zero-battery spec never deploys or harvests', () => {
    const ers = new Ers({ ...SPEC, batteryJ: 0 });
    expect(ers.socJ).toBe(0);
    expect(ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT)).toBeCloseTo(0, 9);
    expect(ers.step({ speedMs: 50, throttle: 0, brake: 1, overtake: false }, DT)).toBeCloseTo(0, 9);
    expect(ers.socJ).toBe(0);
    expect(ers.clipping).toBe(false);
    expect(ers.lapDeployJ).toBe(0);
    expect(ers.lapHarvestJ).toBe(0);
  });

  it('powerW mirrors the last returned value for deploy, harvest and zero steps', () => {
    const ers = new Ers(SPEC);
    const d = ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT);
    expect(ers.powerW).toBe(d);
    const h = ers.step({ speedMs: 50, throttle: 0, brake: 1, overtake: false }, DT);
    expect(ers.powerW).toBe(h);
    expect(ers.step({ speedMs: 10, throttle: 1, brake: 0, overtake: false }, DT)).toBe(0);
    expect(ers.powerW).toBe(0);
  });
});

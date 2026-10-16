import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Ers } from '../../../src/physics/ers';
import type { HybridSpec } from '../../../src/physics/hybridTypes';

const ROOT = join(__dirname, '..', '..', '..');
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

function methodBody(src: string, name: string): string {
  const start = src.indexOf(`${name}(`);
  if (start < 0) throw new Error(`method ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

describe('216 ERS energy model acceptance', () => {
  it('AT1: balance mode at v 50 full throttle deploys 280000 W and updates soc and lap deploy', () => {
    const ers = new Ers(SPEC);
    const p = ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p).toBeCloseTo(280000, 6);
    expect(ers.socJ).toBeCloseTo(4e6 - 280000 / 120, 6);
    expect(ers.lapDeployJ).toBeCloseTo(280000 / 120, 6);
  });

  it('AT2: attack taper from 290 to 345 km/h scales deploy 350000, 175000, 0 without clipping', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    const p1 = ers.step({ speedMs: 290 / 3.6, throttle: 1, brake: 0, overtake: false }, DT);
    const p2 = ers.step({ speedMs: (290 + 345) / 7.2, throttle: 1, brake: 0, overtake: false }, DT);
    const p3 = ers.step({ speedMs: 345 / 3.6, throttle: 1, brake: 0, overtake: false }, DT);
    expect(Math.abs(p1 - 350000)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(p2 - 175000)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(p3 - 0)).toBeLessThanOrEqual(1e-6);
    expect(ers.clipping).toBe(false);
  });

  it('AT3: balance mode at v 96 full throttle super-clips at -175000 W with clipping', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 2e6;
    const p = ers.step({ speedMs: 96, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p).toBeCloseTo(-175000, 6);
    expect(ers.clipping).toBe(true);
  });

  it('AT4: attack overtake at 345 km/h deploys about 194444.44 W, cap 9e6, then 0 at 98.7 m/s', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    const p1 = ers.step({ speedMs: 345 / 3.6, throttle: 1, brake: 0, overtake: true }, DT);
    expect(Math.abs(p1 - (350000 * (355 - 345)) / (355 - 337))).toBeLessThanOrEqual(0.01);
    expect(ers.overtakeUsedThisLap).toBe(true);
    expect(ers.deployCapJ).toBeCloseTo(9e6, 6);
    const p2 = ers.step({ speedMs: 98.7, throttle: 1, brake: 0, overtake: true }, DT);
    expect(p2).toBeCloseTo(0, 9);
  });

  it('AT5: below min speed every input returns 0 and leaves soc unchanged', () => {
    const inputs = [
      { speedMs: 13, throttle: 1, brake: 0, overtake: false },
      { speedMs: 13, throttle: 0, brake: 1, overtake: false },
      { speedMs: 13, throttle: 0, brake: 0, overtake: false },
    ];
    for (const input of inputs) {
      const ers = new Ers(SPEC);
      ers.socJ = 2e6;
      expect(ers.step(input, DT)).toBeCloseTo(0, 9);
      expect(ers.socJ).toBe(2e6);
    }
  });

  it('AT6: regen scales with brake and lifting harvests liftHarvestW, no clipping', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 2e6;
    expect(ers.step({ speedMs: 50, throttle: 0, brake: 0.25, overtake: false }, DT)).toBeCloseTo(
      -175000,
      6,
    );
    expect(ers.clipping).toBe(false);
    expect(ers.step({ speedMs: 50, throttle: 0, brake: 1, overtake: false }, DT)).toBeCloseTo(
      -350000,
      6,
    );
    expect(ers.clipping).toBe(false);
    expect(ers.step({ speedMs: 50, throttle: 0, brake: 0, overtake: false }, DT)).toBeCloseTo(
      -100000,
      6,
    );
    expect(ers.clipping).toBe(false);
  });

  it('AT7: charge mode blocks deploy above the taper start with -350000 clip and deploys 175000 below it', () => {
    const ers = new Ers(SPEC);
    ers.setMode('charge');
    ers.socJ = 2e6;
    const p1 = ers.step({ speedMs: 85, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p1).toBeCloseTo(-350000, 6);
    expect(ers.clipping).toBe(true);
    const p2 = ers.step({ speedMs: 70, throttle: 1, brake: 0, overtake: false }, DT);
    expect(p2).toBeCloseTo(175000, 6);
  });

  it('AT8: lap deploy cap limits power to 120000 then 0, and overtake unlocks 350000', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    ers.lapDeployJ = 8.5e6 - 1000;
    const inp = { speedMs: 50, throttle: 1, brake: 0, overtake: false };
    expect(ers.step(inp, DT)).toBeCloseTo(120000, 6);
    expect(ers.step(inp, DT)).toBeCloseTo(0, 9);
    expect(ers.step({ ...inp, overtake: true }, DT)).toBeCloseTo(350000, 6);
  });

  it('AT9: harvest cap limits regen to -60000 then 0', () => {
    const ers = new Ers(SPEC);
    ers.socJ = 1e6;
    ers.lapHarvestJ = 8.5e6 - 500;
    const inp = { speedMs: 50, throttle: 0, brake: 1, overtake: false };
    expect(ers.step(inp, DT)).toBeCloseTo(-60000, 6);
    expect(ers.step(inp, DT)).toBeCloseTo(0, 9);
  });

  it('AT10: empty battery caps deploy at 120000 draining soc, then balance super-clips -175000', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    ers.socJ = 1000;
    const inp = { speedMs: 50, throttle: 1, brake: 0, overtake: false };
    expect(ers.step(inp, DT)).toBeCloseTo(120000, 6);
    expect(ers.socJ).toBeCloseTo(0, 6);
    expect(ers.step(inp, DT)).toBeCloseTo(0, 9);
    ers.setMode('balance');
    expect(ers.step(inp, DT)).toBeCloseTo(-175000, 6);
    expect(ers.clipping).toBe(true);
  });

  it('AT11: overtake with an empty battery does not arm the overtake flags', () => {
    const ers = new Ers(SPEC);
    ers.setMode('attack');
    ers.socJ = 0;
    const p = ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: true }, DT);
    expect(p).toBeCloseTo(0, 9);
    expect(ers.overtakeActive).toBe(false);
    expect(ers.overtakeUsedThisLap).toBe(false);
  });

  it('AT12: newLap clears lap counters keeping soc; reset restores full battery keeping the mode', () => {
    const ers = new Ers(SPEC);
    ers.step({ speedMs: 50, throttle: 1, brake: 0, overtake: false }, DT);
    const socAfterDeploy = 4e6 - 280000 / 120;
    ers.newLap();
    expect(ers.lapDeployJ).toBe(0);
    expect(ers.lapHarvestJ).toBe(0);
    expect(ers.overtakeUsedThisLap).toBe(false);
    expect(ers.socJ).toBeCloseTo(socAfterDeploy, 6);
    expect(ers.mode).toBe('balance');
    ers.reset();
    expect(ers.socJ).toBe(4e6);
    expect(ers.lapDeployJ).toBe(0);
    expect(ers.lapHarvestJ).toBe(0);
    expect(ers.overtakeUsedThisLap).toBe(false);
    expect(ers.overtakeActive).toBe(false);
    expect(ers.mode).toBe('balance');
  });

  it('AT13: cycleMode on a fresh Ers walks balance, attack, charge, balance', () => {
    const ers = new Ers(SPEC);
    expect(ers.mode).toBe('balance');
    ers.cycleMode();
    expect(ers.mode).toBe('attack');
    ers.cycleMode();
    expect(ers.mode).toBe('charge');
    ers.cycleMode();
    expect(ers.mode).toBe('balance');
  });

  it('AT14: 5000 seeded LCG steps keep soc bounds, lap caps and energy conservation', () => {
    let s = 216 >>> 0;
    const rng = (): number => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    const ers = new Ers(SPEC);
    let socAtLapStart = ers.socJ;
    for (let i = 0; i < 5000; i++) {
      if (i > 0 && i % 500 === 0) ers.cycleMode();
      if (i > 0 && i % 1000 === 0) {
        ers.newLap();
        socAtLapStart = ers.socJ;
      }
      const speedMs = rng() * 100;
      const throttle = rng();
      const brake = i % 2 === 0 ? 0 : rng();
      const overtake = rng() < 0.1;
      ers.step({ speedMs, throttle, brake, overtake }, DT);
      expect(ers.socJ).toBeGreaterThanOrEqual(0);
      expect(ers.socJ).toBeLessThanOrEqual(4e6);
      expect(ers.lapDeployJ).toBeLessThanOrEqual(ers.deployCapJ + 1e-6);
      expect(ers.lapHarvestJ).toBeLessThanOrEqual(8.5e6 + 1e-6);
      expect(Math.abs(ers.socJ - socAtLapStart - (ers.lapHarvestJ - ers.lapDeployJ))).toBeLessThanOrEqual(
        1e-3,
      );
    }
  });

  it('AT15: ers.ts imports nothing from three and step contains no new', () => {
    const src = readFileSync(join(ROOT, 'src', 'physics', 'ers.ts'), 'utf8');
    expect(src).not.toMatch(/['"]three/);
    const body = methodBody(src, 'step');
    expect(body).not.toMatch(/\bnew\s/);
  });
});

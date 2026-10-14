import { describe, it, expect, vi } from 'vitest';
import {
  applyImpact,
  createDamageState,
  damageEffects,
  type CarZones,
  type DamageEffects,
  type Impact,
} from '../../../src/physics/damage';

const ZONES: CarZones = {
  halfLength: 2.5,
  halfWidth: 0.9,
  hubs: [
    { x: -0.75, y: 0, z: -1.37 },
    { x: 0.75, y: 0, z: -1.37 },
    { x: -0.75, y: 0, z: 1.37 },
    { x: 0.75, y: 0, z: 1.37 },
  ],
};

function impact(impulse: number, x: number, y: number, z: number): Impact {
  return { impulse, point: { x, y, z }, otherCar: false };
}

const rng = (): number => 0.5;

describe('144 damage model edge cases', () => {
  it('EDGE1: rear wing zone adds rearWing damage and nothing else', () => {
    const state = createDamageState();
    applyImpact(state, impact(4500, 0, 0, 2.0), ZONES, rng);
    expect(state.rearWing).toBeCloseTo(0.5, 9);
    expect(state.frontWing).toBe(0);
    expect([...state.suspension]).toEqual([0, 0, 0, 0]);
    expect([...state.puncture]).toEqual([false, false, false, false]);
    expect([...state.detached]).toEqual([false, false, false, false]);
  });

  it('EDGE2: hub zone uses 3D distance inclusive at 0.6 m', () => {
    const inclusive = createDamageState();
    applyImpact(inclusive, impact(7500, 0.75, 0.6, -1.37), ZONES, rng);
    expect(inclusive.suspension[1]).toBeCloseTo(0.5, 9);
    expect(inclusive.suspension[0]).toBe(0);
    expect(inclusive.suspension[2]).toBe(0);
    expect(inclusive.suspension[3]).toBe(0);

    const beyond = createDamageState();
    applyImpact(beyond, impact(7500, 0.75, 0.61, -1.37), ZONES, rng);
    expect(beyond).toEqual(createDamageState());
  });

  it('EDGE3: corner zone wins over wing zone when both match', () => {
    const state = createDamageState();
    applyImpact(state, impact(3900, -0.75, 0, -1.55), ZONES, rng);
    expect(state.suspension[0]).toBeCloseTo(0.1, 9);
    expect(state.frontWing).toBe(0);
    expect(state.rearWing).toBe(0);
    expect([...state.suspension.slice(1)]).toEqual([0, 0, 0]);
  });

  it('EDGE4: wing zone thresholds are strict at ±0.6·halfLength', () => {
    const atFront = createDamageState();
    applyImpact(atFront, impact(20000, 0, 0, -1.5), ZONES, rng);
    expect(atFront).toEqual(createDamageState());

    const atRear = createDamageState();
    applyImpact(atRear, impact(20000, 0, 0, 1.5), ZONES, rng);
    expect(atRear).toEqual(createDamageState());
  });

  it('EDGE5: repeated wing hits accumulate and cap at 1, returning the same state', () => {
    const state = createDamageState();
    const first = applyImpact(state, impact(3900, 0, 0.3, -2.3), ZONES, rng);
    expect(first).toBe(state);
    expect(state.frontWing).toBeCloseTo(0.4, 9);
    applyImpact(state, impact(3900, 0, 0.3, -2.3), ZONES, rng);
    expect(state.frontWing).toBeCloseTo(0.8, 9);
    applyImpact(state, impact(3900, 0, 0.3, -2.3), ZONES, rng);
    expect(state.frontWing).toBeCloseTo(1, 9);
    applyImpact(state, impact(3900, 0, 0.3, -2.3), ZONES, rng);
    expect(state.frontWing).toBeCloseTo(1, 9);
  });

  it('EDGE6: negative, NaN and infinite impulses are ignored', () => {
    const negative = vi.fn(rng);
    const atCorner = createDamageState();
    applyImpact(atCorner, impact(-5000, 0.75, 0, -1.37), ZONES, negative);
    expect(atCorner).toEqual(createDamageState());
    expect(negative).not.toHaveBeenCalled();

    const notFinite = vi.fn(rng);
    const nan = createDamageState();
    applyImpact(nan, impact(NaN, -0.75, 0, -1.37), ZONES, notFinite);
    expect(nan).toEqual(createDamageState());

    const infinite = createDamageState();
    applyImpact(infinite, impact(Infinity, 0, 0, 2.0), ZONES, notFinite);
    expect(infinite).toEqual(createDamageState());
    expect(notFinite).not.toHaveBeenCalled();
  });

  it('EDGE7: rng runs only for corner hits with J strictly above 2000', () => {
    const wingSpy = vi.fn(rng);
    applyImpact(createDamageState(), impact(4500, 0, 0.3, -2.3), ZONES, wingSpy);
    expect(wingSpy).not.toHaveBeenCalled();

    const noneSpy = vi.fn(rng);
    applyImpact(createDamageState(), impact(20000, 1.0, 0, 0), ZONES, noneSpy);
    expect(noneSpy).not.toHaveBeenCalled();

    const at2000 = vi.fn(rng);
    const equal = createDamageState();
    applyImpact(equal, impact(2000, -0.75, 0, -1.37), ZONES, at2000);
    expect(at2000).not.toHaveBeenCalled();
    expect(equal).toEqual(createDamageState());

    const above2000 = vi.fn(rng);
    applyImpact(createDamageState(), impact(2001, -0.75, 0, -1.37), ZONES, above2000);
    expect(above2000).toHaveBeenCalledTimes(1);

    const atJ0 = vi.fn(rng);
    const noAdd = createDamageState();
    applyImpact(noAdd, impact(3000, -0.75, 0, -1.37), ZONES, atJ0);
    expect(atJ0).toHaveBeenCalledTimes(1);
    expect(noAdd.suspension[0]).toBe(0);
  });

  it('EDGE8: detach needs suspension already at 1 before the hit and J strictly above 9000', () => {
    const notYet = createDamageState();
    notYet.suspension[0] = 0.9;
    applyImpact(notYet, impact(12000, -0.75, 0, -1.37), ZONES, rng);
    expect(notYet.suspension[0]).toBeCloseTo(1, 9);
    expect(notYet.detached[0]).toBe(false);

    const atThreshold = createDamageState();
    atThreshold.suspension[1] = 1;
    applyImpact(atThreshold, impact(9000, 0.75, 0, -1.37), ZONES, rng);
    expect(atThreshold.detached[1]).toBe(false);
  });

  it('EDGE9: detach forces puncture even when rng rolls no puncture', () => {
    const noPuncture = (): number => 1;
    const state = createDamageState();
    applyImpact(state, impact(12000, -0.75, 0, 1.37), ZONES, noPuncture);
    expect(state.suspension[2]).toBeCloseTo(1, 9);
    expect(state.puncture[2]).toBe(false);
    expect(state.detached[2]).toBe(false);

    applyImpact(state, impact(9001, -0.75, 0, 1.37), ZONES, noPuncture);
    expect(state.detached[2]).toBe(true);
    expect(state.puncture[2]).toBe(true);
  });

  it('EDGE10: damageEffects reuses the out object and defaults a pristine state', () => {
    const out: DamageEffects = {
      aeroFront: -1,
      aeroRear: -1,
      toe: [9, 9, 9, 9],
      gripScale: [9, 9, 9, 9],
    };
    const effects = damageEffects(createDamageState(), out);
    expect(effects).toBe(out);
    expect(effects.aeroFront).toBeCloseTo(1, 9);
    expect(effects.aeroRear).toBeCloseTo(1, 9);
    for (const t of effects.toe) expect(t).toBeCloseTo(0, 9);
    expect([...effects.gripScale]).toEqual([1, 1, 1, 1]);
  });
});

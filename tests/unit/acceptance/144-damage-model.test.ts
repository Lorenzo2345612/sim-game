import { describe, it, expect } from 'vitest';
import {
  applyImpact,
  createDamageState,
  damageEffects,
  type CarZones,
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

describe('144 damage model acceptance', () => {
  it('AT1: J 4500 at the nose adds frontWing 0.5 and leaves everything else at 0', () => {
    const state = createDamageState();
    applyImpact(state, impact(4500, 0, 0.3, -2.3), ZONES, rng);
    expect(state.frontWing).toBeCloseTo(0.5, 9);
    expect(state.rearWing).toBe(0);
    expect([...state.suspension]).toEqual([0, 0, 0, 0]);
    expect([...state.puncture]).toEqual([false, false, false, false]);
    expect([...state.detached]).toEqual([false, false, false, false]);
  });

  it('AT2: J 1400 anywhere leaves the state unchanged', () => {
    const wing = createDamageState();
    applyImpact(wing, impact(1400, 0, 0.3, -2.3), ZONES, rng);
    expect(wing).toEqual(createDamageState());

    const corner = createDamageState();
    applyImpact(corner, impact(1400, 0.85, 0, -1.37), ZONES, rng);
    expect(corner).toEqual(createDamageState());
  });

  it('AT3: J 7500 at the FR hub adds suspension[1] 0.5 and punctures when rng is below the threshold', () => {
    const punctured = createDamageState();
    applyImpact(punctured, impact(7500, 0.85, 0, -1.37), ZONES, () => 0.1);
    expect(punctured.suspension[1]).toBeCloseTo(0.5, 9);
    expect(punctured.puncture[1]).toBe(true);

    const intact = createDamageState();
    applyImpact(intact, impact(7500, 0.85, 0, -1.37), ZONES, () => 0.95);
    expect(intact.puncture[1]).toBe(false);
  });

  it('AT4: two J 12000 hits at the RL hub first max suspension[2] then detach it', () => {
    const state = createDamageState();
    applyImpact(state, impact(12000, -0.75, 0, 1.37), ZONES, rng);
    expect(state.suspension[2]).toBeCloseTo(1, 9);
    expect(state.detached[2]).toBe(false);
    applyImpact(state, impact(12000, -0.75, 0, 1.37), ZONES, rng);
    expect(state.detached[2]).toBe(true);
    expect(state.puncture[2]).toBe(true);
  });

  it('AT5: damageEffects derives aero, toe and grip from the damaged state', () => {
    const state = createDamageState();
    state.frontWing = 1;
    state.rearWing = 0.5;
    state.suspension[0] = 1;
    state.puncture[1] = true;
    const effects = damageEffects(state);
    expect(effects.aeroFront).toBeCloseTo(0.3, 9);
    expect(effects.aeroRear).toBeCloseTo(0.75, 9);
    expect(effects.toe[0]).toBeCloseTo(0.03, 9);
    expect(effects.gripScale[0]).toBeCloseTo(1, 9);
    expect(effects.gripScale[1]).toBeCloseTo(0.35, 9);
    expect(effects.gripScale[2]).toBeCloseTo(1, 9);
    expect(effects.gripScale[3]).toBeCloseTo(1, 9);
  });

  it('AT6: side impact at (1.0, 0, 0) with no hub within 0.6 m leaves the state unchanged', () => {
    const state = createDamageState();
    applyImpact(state, impact(20000, 1.0, 0, 0), ZONES, rng);
    expect(state).toEqual(createDamageState());
  });
});

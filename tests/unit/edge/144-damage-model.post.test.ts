import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

function impact(impulse: number, x: number, y: number, z: number, otherCar = false): Impact {
  return { impulse, point: { x, y, z }, otherCar };
}

describe('144 damage model post-code gaps', () => {
  it('zero impulse is ignored without rolling rng', () => {
    const spy = vi.fn((): number => 0);
    const state = createDamageState();
    applyImpact(state, impact(0, 0.75, 0, -1.37), ZONES, spy);
    expect(state).toEqual(createDamageState());
    expect(spy).not.toHaveBeenCalled();
  });

  it('corner hit below the puncture threshold adds nothing and never rolls rng', () => {
    const spy = vi.fn((): number => 0.99);
    const state = createDamageState();
    applyImpact(state, impact(1500, 0.75, 0, -1.37), ZONES, spy);
    expect(state).toEqual(createDamageState());
    expect(spy).not.toHaveBeenCalled();
  });

  it('impulses far above the scales clamp damage and puncture probability', () => {
    const wing = createDamageState();
    applyImpact(wing, impact(1e9, 0, 0.3, -2.3), ZONES, () => 0);
    expect(wing.frontWing).toBe(1);

    const corner = createDamageState();
    applyImpact(corner, impact(1e9, -0.75, 0, 1.37), ZONES, () => 0.999);
    expect(corner.suspension[2]).toBe(1);
    expect(corner.puncture[2]).toBe(true);
  });

  it('puncture roll is strictly below the clamped probability', () => {
    const atThreshold = createDamageState(); // p = (5000-2000)/6000 = 0.5
    applyImpact(atThreshold, impact(5000, 0.75, 0, -1.37), ZONES, () => 0.5);
    expect(atThreshold.puncture[1]).toBe(false);

    const below = createDamageState();
    applyImpact(below, impact(5000, 0.75, 0, -1.37), ZONES, () => 0.49);
    expect(below.puncture[1]).toBe(true);

    const saturated = createDamageState(); // p clamps to 1, still strict
    applyImpact(saturated, impact(8000, 0.75, 0, -1.37), ZONES, () => 1);
    expect(saturated.puncture[1]).toBe(false);
  });

  it('nearest hub receives the hit when several fall inside the radius', () => {
    const closeZones: CarZones = {
      halfLength: 2.5,
      halfWidth: 0.9,
      hubs: [
        { x: -0.2, y: 0, z: -1.37 },
        { x: 0.2, y: 0, z: -1.37 },
        { x: -0.2, y: 0, z: 1.37 },
        { x: 0.2, y: 0, z: 1.37 },
      ],
    };
    const state = createDamageState();
    applyImpact(state, impact(7500, 0.05, 0, -1.37), closeZones, () => 0.99);
    expect(state.suspension[1]).toBeCloseTo(0.5, 9);
    expect(state.suspension[0]).toBe(0);
  });

  it('toe keeps wheel order with front/rear gains and alternating signs', () => {
    const state = createDamageState();
    state.suspension = [1, 1, 1, 1];
    state.detached[0] = true; // detachment does not alter toe
    const effects = damageEffects(state);
    expect(effects.toe[0]).toBeCloseTo(0.03, 9);
    expect(effects.toe[1]).toBeCloseTo(-0.03, 9);
    expect(effects.toe[2]).toBeCloseTo(0.02, 9);
    expect(effects.toe[3]).toBeCloseTo(-0.02, 9);
  });

  it('full rear wing damage halves rear aero and leaves front aero intact', () => {
    const state = createDamageState();
    state.rearWing = 1;
    const effects = damageEffects(state);
    expect(effects.aeroRear).toBeCloseTo(0.5, 9);
    expect(effects.aeroFront).toBeCloseTo(1, 9);
  });

  it('grip scale is zero for any detached wheel, even when punctured', () => {
    const state = createDamageState();
    state.detached[0] = true;
    state.detached[3] = true;
    state.puncture[3] = true;
    const effects = damageEffects(state);
    expect([...effects.gripScale]).toEqual([0, 1, 1, 0]);
  });

  it('puncture and suspension survive later sub-threshold hits', () => {
    const state = createDamageState();
    applyImpact(state, impact(8000, -0.75, 0, -1.37), ZONES, () => 0);
    expect(state.puncture[0]).toBe(true);
    const suspension = state.suspension[0];
    applyImpact(state, impact(1500, -0.75, 0, -1.37), ZONES, () => 0);
    expect(state.puncture[0]).toBe(true);
    expect(state.suspension[0]).toBe(suspension);
  });

  it('applyImpact leaves the impact and zones objects untouched', () => {
    const hit = impact(12000, 0.75, 0, -1.37);
    const zones: CarZones = JSON.parse(JSON.stringify(ZONES)) as CarZones;
    applyImpact(createDamageState(), hit, zones, () => 0);
    expect(hit).toEqual(impact(12000, 0.75, 0, -1.37));
    expect(zones).toEqual(ZONES);
  });

  it('createDamageState returns independent instances', () => {
    const a = createDamageState();
    const b = createDamageState();
    a.frontWing = 1;
    a.suspension[0] = 1;
    a.puncture[2] = true;
    a.detached[3] = true;
    expect(b).toEqual(createDamageState());
  });

  it('otherCar does not change the outcome of an impact', () => {
    const direct = createDamageState();
    applyImpact(direct, impact(7500, 0.85, 0, -1.37), ZONES, () => 0.1);
    const carToCar = createDamageState();
    applyImpact(carToCar, impact(7500, 0.85, 0, -1.37, true), ZONES, () => 0.1);
    expect(carToCar).toEqual(direct);
  });

  it('damage.ts imports neither three nor rapier', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/physics/damage.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*three/);
    expect(src).not.toMatch(/@dimforge/);
    expect(src).not.toMatch(/rapier/i);
  });
});

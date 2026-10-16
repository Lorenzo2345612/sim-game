import { describe, it, expect } from 'vitest';
import { HeadMotion } from '../../../src/render/headMotion';
import { SETTINGS_KEY, loadCockpitSettings, type KeyValueStorage } from '../../../src/core/settings';

const STEP = 1 / 120;

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function run(latG: number, longG: number, seconds: number): { x: number; z: number } {
  const hm = new HeadMotion();
  let out = { x: 0, z: 0 };
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) out = hm.update(latG, longG, STEP);
  return { x: out.x, z: out.z };
}

function storageWith(json: string): KeyValueStorage {
  return {
    getItem: (k: string) => (k === SETTINGS_KEY ? json : null),
    setItem: () => {},
  };
}

describe('118 head motion and FOV acceptance', () => {
  it('AT1: constant latG 2, longG 0 for 2 s at 1/120 gives x = -0.024, z = 0', () => {
    const out = run(2, 0, 2);
    within(out.x, -0.024, 1e-4);
    within(out.z, 0, 1e-9);
  });

  it('AT2: latG 10 / longG -5 for 2 s clamps to x = -0.04, z = -0.04', () => {
    const out = run(10, -5, 2);
    within(out.x, -0.04, 1e-4);
    within(out.z, -0.04, 1e-4);
  });

  it('AT3: step latG 0 to 2 after 0.15 s gives x = -0.024*(1 - e^-1)', () => {
    const hm = new HeadMotion();
    let out = { x: 0, z: 0 };
    const steps = Math.round(0.15 / STEP);
    for (let i = 0; i < steps; i++) out = hm.update(2, 0, STEP);
    within(out.x, -0.024 * (1 - Math.exp(-1)), 5e-4);
  });

  it('AT4: settings without cockpitFov load 75; cockpitFov 120 clamps to 100', () => {
    const missing = loadCockpitSettings(storageWith('{"preset":"high"}'));
    expect(missing.cockpitFov).toBe(75);
    const high = loadCockpitSettings(storageWith('{"cockpitFov":120}'));
    expect(high.cockpitFov).toBe(100);
  });
});

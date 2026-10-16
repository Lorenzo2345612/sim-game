import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ActiveAero } from '../../../src/physics/activeAero';
import { aeroForces, type AeroForces } from '../../../src/physics/aero';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { ActiveAeroSpec } from '../../../src/physics/hybridTypes';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;
const AA: ActiveAeroSpec = { dragScale: 0.7, downforceScale: 0.6, transitionS: 0.4 };

function f4(activeAero?: ActiveAeroSpec): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  const spec = parseCarSpec(json);
  spec.aero.cda = 1;
  spec.aero.claFront = 1.5;
  spec.aero.claRear = 2;
  spec.aero.rideHeightSens = 0;
  spec.activeAero = activeAero;
  return spec;
}

function expectForces(out: AeroForces, drag: number, front: number, rear: number): void {
  expect(Math.abs(out.drag - drag)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(out.front - front)).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(out.rear - rear)).toBeLessThanOrEqual(1e-6);
}

describe('218 active-aero state and aero blend acceptance', () => {
  it('AT1: 24 zone updates at throttle 1, brake 0 reach blend 0.5 with straightMode true; 48 total reach 1', () => {
    const aa = new ActiveAero(AA);
    for (let i = 0; i < 24; i++) aa.update(true, 1, 0, DT);
    expect(Math.abs(aa.blend - 0.5)).toBeLessThanOrEqual(1e-9);
    expect(aa.straightMode).toBe(true);
    for (let i = 0; i < 24; i++) aa.update(true, 1, 0, DT);
    expect(Math.abs(aa.blend - 1)).toBeLessThanOrEqual(1e-9);
  });

  it('AT2: from blend 1, updates with brake 0.1 give blend > 0 at 47 and 0 at 48', () => {
    const aa = new ActiveAero(AA);
    for (let i = 0; i < 48; i++) aa.update(true, 1, 0, DT);
    for (let i = 0; i < 47; i++) aa.update(true, 1, 0.1, DT);
    expect(aa.blend).toBeGreaterThan(0);
    aa.update(true, 1, 0.1, DT);
    expect(Math.abs(aa.blend)).toBeLessThanOrEqual(1e-9);
  });

  it('AT3: blend 0 stays 0 over 60 updates each with throttle 0.89, out of zone, and brake 0.05', () => {
    const cases: Array<[boolean, number, number]> = [
      [true, 0.89, 0],
      [false, 1, 0],
      [true, 1, 0.05],
    ];
    for (const [inZone, throttle, brake] of cases) {
      const aa = new ActiveAero(AA);
      for (let i = 0; i < 60; i++) aa.update(inZone, throttle, brake, DT);
      expect(Math.abs(aa.blend)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT4: aeroForces with activeAero gives drag/front/rear for b = 0, 1, 0.5', () => {
    const spec = f4(AA);
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, 0), 1531.25, 2296.875, 3062.5);
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, 1), 1071.875, 1378.125, 1837.5);
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, 0.5), 1301.5625, 1837.5, 2450);
  });

  it('AT5: spec without activeAero at blend 1 matches the b = 0 forces', () => {
    const spec = f4();
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, 1), 1531.25, 2296.875, 3062.5);
  });

  it('AT6: activeBlend -1 and 2 match the b = 0 and b = 1 forces', () => {
    const spec = f4(AA);
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, -1), 1531.25, 2296.875, 3062.5);
    expectForces(aeroForces(spec, 50, 0, undefined, undefined, 2), 1071.875, 1378.125, 1837.5);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLACEHOLDER_CAR } from '../../../src/physics/vehicleConfig';

function sourceOf(file: string): string {
  return readFileSync(new URL(`../../../src/physics/${file}`, import.meta.url), 'utf8');
}

describe('vehicleConfig', () => {
  it('PLACEHOLDER_CAR deep-equals the architecture.md values', () => {
    expect(PLACEHOLDER_CAR).toEqual({
      massKg: 650,
      chassisHalfExtents: { x: 0.8, y: 0.2, z: 2.0 },
      wheelRadius: 0.33,
      suspensionRestLength: 0.12,
      maxSuspensionTravel: 0.1,
      suspensionStiffness: 60,
      suspensionCompression: 4.4,
      suspensionRelaxation: 2.3,
      frictionSlip: 2.2,
      sideFrictionStiffness: 1.0,
      wheelPositions: [
        { x: -0.8, y: 0, z: -1.3 },
        { x: 0.8, y: 0, z: -1.3 },
        { x: -0.8, y: 0, z: 1.25 },
        { x: 0.8, y: 0, z: 1.25 },
      ],
      enginePowerW: 130000,
      maxDriveForceN: 6000,
      brakeMax: 20,
      maxSteerLowSpeed: 0.35,
      maxSteerHighSpeed: 0.1,
      dragAreaCdA: 0.9,
      liftAreaClA: 2.0,
    });
  });

  it('wheelPositions are ordered FL, FR, RL, RR with front at -x and -z', () => {
    const [fl, fr, rl, rr] = PLACEHOLDER_CAR.wheelPositions;
    expect(fl.x).toBeLessThan(0);
    expect(fl.z).toBeLessThan(0);
    expect(fr.x).toBeGreaterThan(0);
    expect(fr.z).toBeLessThan(0);
    expect(rl.x).toBeLessThan(0);
    expect(rl.z).toBeGreaterThan(0);
    expect(rr.x).toBeGreaterThan(0);
    expect(rr.z).toBeGreaterThan(0);
  });

  it('vehicleConfig.ts does not import Rapier or three', () => {
    const src = sourceOf('vehicleConfig.ts');
    expect(src.toLowerCase()).not.toContain('rapier');
    expect(src).not.toMatch(/from ['"]three['"]/);
  });

  it('src/physics modules never import three', () => {
    expect(sourceOf('physicsWorld.ts')).not.toMatch(/from ['"]three(-|['"])/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec, type Vec3 } from '../../../src/physics/carSpec';
import { COCKPIT_OFFSET } from '../../../src/render/cameraRig';

const ROOT = join(__dirname, '..', '..', '..');
const TOL = 1e-9;

interface CockpitJson {
  eye: Vec3;
  wheel: Vec3;
  wheelRadius: number;
  lockDeg: number;
}

function rawCar(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8')) as Record<
    string,
    unknown
  >;
}

function cockpitOf(spec: CarSpec): CockpitJson {
  return (spec as CarSpec & { cockpit: CockpitJson }).cockpit;
}

describe('115 cockpit data acceptance', () => {
  it('AT1: f4 and gt3-a parse with cockpit present, wheel behind and below the eye, lockDeg 270 / 480', () => {
    const cases = [
      { id: 'f4', lockDeg: 270 },
      { id: 'gt3-a', lockDeg: 480 },
    ] as const;
    for (const c of cases) {
      const cockpit = cockpitOf(parseCarSpec(rawCar(c.id)));
      expect(cockpit, c.id).toBeDefined();
      expect(cockpit.wheel.z, c.id).toBeLessThan(cockpit.eye.z);
      expect(cockpit.wheel.y, c.id).toBeLessThan(cockpit.eye.y);
      expect(cockpit.lockDeg, c.id).toBe(c.lockDeg);
    }
  });

  it('AT2: JSON without cockpit gets eye = COCKPIT_OFFSET, wheel = eye + (0, -0.15, -0.45) +/- 1e-9, wheelRadius 0.13, lockDeg 270', () => {
    const json = rawCar('f4');
    delete (json as { cockpit?: unknown }).cockpit;
    const cockpit = cockpitOf(parseCarSpec(json));
    expect(cockpit).toBeDefined();
    expect(cockpit.eye).toEqual({
      x: COCKPIT_OFFSET.x,
      y: COCKPIT_OFFSET.y,
      z: COCKPIT_OFFSET.z,
    });
    expect(Math.abs(cockpit.wheel.x - COCKPIT_OFFSET.x)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(cockpit.wheel.y - (COCKPIT_OFFSET.y - 0.15))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(cockpit.wheel.z - (COCKPIT_OFFSET.z - 0.45))).toBeLessThanOrEqual(TOL);
    expect(cockpit.wheelRadius).toBe(0.13);
    expect(cockpit.lockDeg).toBe(270);
  });

  it('AT3: wheelRadius 0 or 0.31, lockDeg 0 or 1081 make parseCarSpec throw', () => {
    const bad = [{ wheelRadius: 0 }, { wheelRadius: 0.31 }, { lockDeg: 0 }, { lockDeg: 1081 }];
    for (const cockpit of bad) {
      const json = rawCar('f4');
      json.cockpit = cockpit;
      expect(() => parseCarSpec(json)).toThrow();
    }
  });
});

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { F4_CAR } from '../../../src/physics/vehicleConfig';

const ROOT = join(__dirname, '..', '..', '..');
// This file names the banned tokens below, so it must not scan itself.
const SELF = resolve(__dirname, '057-f4-car-integration.test.ts');
const POS_TOL = 1e-3;

interface F4Meta {
  wheelRadius: number;
  wheels: { name: string; x: number; y: number; z: number }[];
}

function readMeta(): F4Meta {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'models', 'f4.json'), 'utf8')) as F4Meta;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

describe('057 F4 car integration acceptance', () => {
  it('AT1: F4_CAR matches f4.json hubs and the architecture physics values', () => {
    const meta = readMeta();
    expect(Math.abs(F4_CAR.wheelRadius - meta.wheelRadius)).toBeLessThanOrEqual(POS_TOL);
    expect(F4_CAR.wheelPositions.length).toBe(meta.wheels.length);
    meta.wheels.forEach((hub, i) => {
      const pos = F4_CAR.wheelPositions[i];
      expect(Math.abs(pos.x - hub.x)).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(pos.z - hub.z)).toBeLessThanOrEqual(POS_TOL);
      expect(pos.y).toBe(0);
    });
    expect(F4_CAR.massKg).toBe(650);
    expect(F4_CAR.enginePowerW).toBe(130000);
    expect(F4_CAR.dragAreaCdA).toBe(0.9);
    expect(F4_CAR.liftAreaClA).toBe(2.0);
  });

  it('AT2: placeholder assets and Kenney/Tatuus references are gone', () => {
    expect(existsSync(join(ROOT, 'public', 'models', 'race.glb'))).toBe(false);
    expect(existsSync(join(ROOT, 'assets', 'vendor', 'kenney-car-kit'))).toBe(false);

    const bannedRefFiles = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'tests')).filter((path) => resolve(path) !== SELF),
      join(ROOT, 'index.html'),
    ].filter((path) => {
      const text = readFileSync(path, 'utf8').toLowerCase();
      return text.includes('race.glb') || text.includes('kenney');
    });
    expect(bannedRefFiles).toEqual([]);

    const kenneyRows = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8')
      .split('\n')
      .filter((line) => /car-kit|car kit|race\.glb/i.test(line));
    expect(kenneyRows).toEqual([]);

    const tatuusFiles = [
      ...walk(join(ROOT, 'src')),
      ...walk(join(ROOT, 'public')),
      join(ROOT, 'index.html'),
    ].filter((path) => readFileSync(path).toString('latin1').toLowerCase().includes('tatuus'));
    expect(tatuusFiles).toEqual([]);
  });
});

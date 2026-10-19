import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const POS_TOL = 1e-3;
const DYNAMICS_SECTIONS = ['engine', 'gearbox', 'aero', 'tyres', 'brakes', 'aids', 'fuel'] as const;

interface ModelMeta {
  wheelRadius: number;
  wheels: { x: number; y: number; z: number }[];
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(ROOT, ...segments), 'utf8')) as T;
}

function gt3DSpec() {
  return parseCarSpec(readJson('public', 'cars', 'gt3-d.json'));
}

describe('076 gt3-d acceptance', () => {
  it('AT1: gt3-d.json parses ok with category gt3 and name GT3 D', () => {
    const spec = gt3DSpec();
    expect(spec.category as string).toBe('gt3');
    expect(spec.name).toBe('GT3 D');
  });

  it('AT2: wheel positions match the model hubs in x and z, and y = wheelRadius - cgHeight', () => {
    const spec = gt3DSpec();
    const meta = readJson<ModelMeta>('public', 'models', 'gt3-d.json');
    expect(spec.wheels.positions).toHaveLength(4);
    const y = meta.wheelRadius - spec.chassis.cgHeight;
    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = spec.wheels.positions[i];
      expect(Math.abs(px - meta.wheels[i].x), `wheel ${i} x`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(pz - meta.wheels[i].z), `wheel ${i} z`).toBeLessThanOrEqual(POS_TOL);
      expect(Math.abs(py - y), `wheel ${i} y`).toBeLessThanOrEqual(POS_TOL);
    }
  });

  it('AT3: dynamics sections deep-equal gt3-a.json', () => {
    const d = readJson<Record<string, unknown>>('public', 'cars', 'gt3-d.json');
    const a = readJson<Record<string, unknown>>('public', 'cars', 'gt3-a.json');
    // 255 gives each car its own weightFront / rearMuScale / widths.
    const strip = (section: string, v: unknown): unknown => {
      const o = { ...(v as Record<string, unknown>) };
      if (section === 'tyres') delete o.rearMuScale;
      return o;
    };
    for (const section of DYNAMICS_SECTIONS) {
      expect(strip(section, d[section]), section).toEqual(strip(section, a[section]));
    }
  });
});

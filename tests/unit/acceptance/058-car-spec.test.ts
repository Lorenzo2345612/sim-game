import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type SetupKey } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');

const SETUP_KEYS: SetupKey[] = [
  'frontWing',
  'rearWing',
  'brakeBias',
  'finalDrive',
  'arbFront',
  'arbRear',
  'rideHeight',
  'tyrePressureKpa',
];

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(ROOT, ...segments), 'utf8'));
}

function f4Json(): Record<string, unknown> {
  return readJson('public', 'cars', 'f4.json') as Record<string, unknown>;
}

function collectNumbers(
  node: unknown,
  path: Array<string | number>,
  out: Array<{ path: Array<string | number>; value: number }>,
): void {
  if (typeof node === 'number') {
    out.push({ path: [...path], value: node });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectNumbers(child, [...path, i], out));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      collectNumbers(child, [...path, key], out);
    }
  }
}

function valueAt(root: unknown, path: ReadonlyArray<string | number>): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

describe('058 car spec type, loader and F4 data acceptance', () => {
  it('AT1: parseCarSpec of f4.json returns massKg 650, 4 wheel positions, soft/medium/hard compounds and 8 setup ranges with min <= default <= max', () => {
    const spec = parseCarSpec(f4Json());
    expect(spec.chassis.massKg).toBe(650);
    expect(spec.wheels.positions).toHaveLength(4);
    expect(Object.keys(spec.tyres.compounds).sort()).toEqual(['hard', 'inter', 'medium', 'soft', 'wet']);
    expect(Object.keys(spec.setup).sort()).toEqual([...SETUP_KEYS].sort());
    for (const key of Object.keys(spec.setup) as SetupKey[]) {
      const range = spec.setup[key];
      expect(range.min).toBeLessThanOrEqual(range.default);
      expect(range.default).toBeLessThanOrEqual(range.max);
    }
  });

  it('AT2: f4 json without chassis.massKg throws with a message containing chassis.massKg', () => {
    const json = f4Json();
    const chassis = json.chassis as Record<string, unknown>;
    delete chassis.massKg;
    expect(() => parseCarSpec(json)).toThrow(/chassis\.massKg/);
  });

  it('AT3: absent chassis.inertia yields Ix = 650*(0.4^2+4^2)/12 within 1e-6 for halfExtents 0.8/0.2/2.0', () => {
    const json = f4Json();
    const chassis = json.chassis as Record<string, unknown>;
    delete chassis.inertia;
    chassis.halfExtents = { x: 0.8, y: 0.2, z: 2.0 };
    chassis.massKg = 650;
    const spec = parseCarSpec(json);
    const expected = (650 * (0.4 ** 2 + 4 ** 2)) / 12;
    expect(Math.abs(spec.chassis.inertia.x - expected)).toBeLessThanOrEqual(1e-6);
  });

  it('AT4: every numeric field of ai/lab/f4-carspec.json is equal in public/cars/f4.json', () => {
    const f4 = f4Json();
    const lab = readJson('ai', 'lab', 'f4-carspec.json');
    const leaves: Array<{ path: Array<string | number>; value: number }> = [];
    collectNumbers(lab, [], leaves);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(valueAt(f4, leaf.path), leaf.path.join('.')).toBeCloseTo(leaf.value, 9);
    }
  });

  it('AT5: every preset value lies within its setup range', () => {
    const spec = parseCarSpec(f4Json());
    for (const preset of ['stable', 'balanced', 'aggressive'] as const) {
      for (const key of SETUP_KEYS) {
        const range = spec.setup[key];
        const value = spec.presets[preset][key];
        expect(value, `${preset}.${key}`).toBeGreaterThanOrEqual(range.min);
        expect(value, `${preset}.${key}`).toBeLessThanOrEqual(range.max);
      }
    }
  });
});

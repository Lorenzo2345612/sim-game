import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const CARS = [
  { id: 'lmp2-a', category: 'lmp2', name: 'LMP2 A', lab: 'lmp2-carspec.json' },
  { id: 'hyper-a', category: 'hypercar', name: 'Hypercar A', lab: 'hypercar-carspec.json' },
] as const;
const BRANDS = [
  'mclaren',
  'porsche',
  'porche',
  'audi',
  'tatuus',
  'lamborghini',
  'ligier',
  'cadillac',
  'ferrari',
  'oreca',
  'katattak',
];
const POS_TOL = 1e-3;

interface ModelMeta {
  wheelRadius: number;
  wheels: { x: number; y: number; z: number }[];
}

interface LabJson {
  chassis: { massKg: number; cgHeight: number };
  engine: unknown;
  gearbox: unknown;
  aero: { cda: number; claFront: number; claRear: number; rideHeightSens: number };
  tyres: { optPressureKpa: number; compounds: { medium: unknown } };
  brakes: unknown;
  aids: unknown;
  fuel: unknown;
}

function readJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(ROOT, ...segments), 'utf8')) as T;
}

function carSpec(id: string): CarSpec {
  return parseCarSpec(readJson('public', 'cars', `${id}.json`));
}

function modelMeta(id: string): ModelMeta {
  return readJson('public', 'models', `${id}.json`);
}

function labJson(file: string): LabJson {
  return readJson('ai', 'lab', file);
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out;
}

describe('113 prototype car specs acceptance', () => {
  it('AT1: each file parses ok with category lmp2/hypercar and name LMP2 A / Hypercar A', () => {
    for (const car of CARS) {
      const spec = carSpec(car.id);
      expect(spec.category as string, car.id).toBe(car.category);
      expect(spec.name, car.id).toBe(car.name);
    }
  });

  it('AT2: wheel positions match the model hubs in x and z, and y = wheelRadius - cgHeight', () => {
    for (const car of CARS) {
      const spec = carSpec(car.id);
      const meta = modelMeta(car.id);
      const cgHeight = labJson(car.lab).chassis.cgHeight;
      expect(spec.wheels.positions, car.id).toHaveLength(4);
      expect(meta.wheels, car.id).toHaveLength(4);
      const y = meta.wheelRadius - cgHeight;
      for (let i = 0; i < 4; i++) {
        const [px, py, pz] = spec.wheels.positions[i];
        expect(Math.abs(px - meta.wheels[i].x), `${car.id} wheel ${i} x`).toBeLessThanOrEqual(POS_TOL);
        expect(Math.abs(pz - meta.wheels[i].z), `${car.id} wheel ${i} z`).toBeLessThanOrEqual(POS_TOL);
        expect(Math.abs(py - y), `${car.id} wheel ${i} y`).toBeLessThanOrEqual(POS_TOL);
      }
    }
  });

  it('AT3: engine, gearbox, aero, tyres, brakes, aids, fuel and mass deep-equal the lab spec', () => {
    for (const car of CARS) {
      const spec = carSpec(car.id);
      const lab = labJson(car.lab);
      expect(spec.engine, car.id).toEqual(lab.engine);
      expect(spec.gearbox, car.id).toEqual(lab.gearbox);
      expect(
        {
          cda: spec.aero.cda,
          claFront: spec.aero.claFront,
          claRear: spec.aero.claRear,
          rideHeightSens: spec.aero.rideHeightSens,
        },
        car.id,
      ).toEqual(lab.aero);
      expect(
        {
          optPressureKpa: spec.tyres.optPressureKpa,
          compounds: { medium: spec.tyres.compounds.medium },
        },
        car.id,
      ).toEqual(lab.tyres);
      expect(spec.brakes, car.id).toEqual(lab.brakes);
      expect(spec.aids, car.id).toEqual(lab.aids);
      expect(spec.fuel, car.id).toEqual(lab.fuel);
      expect(spec.chassis.massKg, car.id).toBe(lab.chassis.massKg);
    }
  });

  it('AT4: no brand names in public/cars or src', () => {
    const pattern = new RegExp(`\\b(${BRANDS.join('|')})\\b`, 'i');
    for (const dir of [join(ROOT, 'public', 'cars'), join(ROOT, 'src')]) {
      for (const file of listFiles(dir)) {
        const text = readFileSync(file, 'utf8').toLowerCase();
        expect(pattern.test(text), file).toBe(false);
      }
    }
  });
});

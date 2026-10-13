import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const CAR_IDS = ['gt3-a', 'gt3-b', 'gt3-c'] as const;
const BRANDS = ['mclaren', 'porsche', 'porche', 'audi', 'tatuus', 'lamborghini'];
const POS_TOL = 1e-3;

interface ModelMeta {
  wheelRadius: number;
  wheels: { x: number; y: number; z: number }[];
}

interface LabJson {
  chassis: { cgHeight: number };
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

function labJson(): LabJson {
  return readJson('ai', 'lab', 'gt3-carspec.json');
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

describe('072 gt3 cars acceptance', () => {
  it('AT1: each file parses ok with mass 1300, category gt3 and a GT3 A/B/C name', () => {
    for (const id of CAR_IDS) {
      const spec = carSpec(id);
      expect(spec.chassis.massKg, id).toBe(1300);
      expect(spec.category as string, id).toBe('gt3');
      expect(spec.name, id).toMatch(/^GT3 [ABC]$/);
    }
  });

  it('AT2: wheel positions match the model hubs in x and z, and y = wheelRadius - cgHeight', () => {
    const cgHeight = labJson().chassis.cgHeight;
    for (const id of CAR_IDS) {
      const spec = carSpec(id);
      const meta = modelMeta(id);
      expect(spec.wheels.positions, id).toHaveLength(4);
      expect(meta.wheels, id).toHaveLength(4);
      const y = meta.wheelRadius - cgHeight;
      for (let i = 0; i < 4; i++) {
        const [px, py, pz] = spec.wheels.positions[i];
        expect(Math.abs(px - meta.wheels[i].x), `${id} wheel ${i} x`).toBeLessThanOrEqual(POS_TOL);
        expect(Math.abs(pz - meta.wheels[i].z), `${id} wheel ${i} z`).toBeLessThanOrEqual(POS_TOL);
        expect(Math.abs(py - y), `${id} wheel ${i} y`).toBeLessThanOrEqual(POS_TOL);
      }
    }
  });

  it('AT3: engine, gearbox, aero, tyres, brakes, aids and fuel deep-equal the lab spec', () => {
    const lab = labJson();
    for (const id of CAR_IDS) {
      const spec = carSpec(id);
      expect(spec.engine, id).toEqual(lab.engine);
      expect(spec.gearbox, id).toEqual(lab.gearbox);
      expect(
        {
          cda: spec.aero.cda,
          claFront: spec.aero.claFront,
          claRear: spec.aero.claRear,
          rideHeightSens: spec.aero.rideHeightSens,
        },
        id,
      ).toEqual(lab.aero);
      expect(
        {
          optPressureKpa: spec.tyres.optPressureKpa,
          compounds: { medium: spec.tyres.compounds.medium },
        },
        id,
      ).toEqual(lab.tyres);
      expect(spec.brakes, id).toEqual(lab.brakes);
      expect(spec.aids, id).toEqual(lab.aids);
      expect(spec.fuel, id).toEqual(lab.fuel);
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

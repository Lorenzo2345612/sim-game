import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { NodeIO, getBounds } from '@gltf-transform/core';

const ROOT = join(__dirname, '..', '..', '..');

const CARS = [
  {
    id: 'lmp2-a',
    forward: '-z',
    wheelMaterials: ['customtire'],
    wheelSourceMaterials: ['material_5_customtiregfgoodtire_inst_9bb5d'],
    heightMax: 1.25,
  },
  {
    id: 'hyper-a',
    forward: '-z',
    wheelMaterials: ['tier1mtl', 'rim1mtl', 'disc1mtl', 'caliper1mtl'],
    wheelSourceMaterials: ['Tier1Mtl', 'Rim1Mtl', 'Disc1Mtl', 'Caliper1Mtl'],
    heightMax: 1.45,
  },
] as const;

interface Config {
  source: string;
  forward: string;
  liveryMaterials: string[];
  wheelMaterials: string[];
  wheelNodes?: string[];
}

function readConfig(id: string): Config {
  return JSON.parse(readFileSync(join(ROOT, 'assets', 'cars', `${id}.pipeline.json`), 'utf8')) as Config;
}

describe('112 wheel selection gaps', () => {
  it('POST17: each in-scope config pins forward -z, empty liveryMaterials, its wheelMaterials and no wheelNodes', () => {
    for (const car of CARS) {
      const config = readConfig(car.id);
      expect(config.forward, car.id).toBe(car.forward);
      expect(config.liveryMaterials, car.id).toEqual([]);
      expect(config.wheelMaterials, car.id).toEqual([...car.wheelMaterials]);
      expect(config.wheelNodes, car.id).toBeUndefined();
    }
  });

  it('POST18: each config wheelMaterials list selects exactly the inspected source materials', async () => {
    for (const car of CARS) {
      const config = readConfig(car.id);
      const doc = await new NodeIO().read(join(ROOT, config.source));
      const names = doc.getRoot().listMaterials().map((m) => m.getName());
      const matched = names.filter((n) =>
        config.wheelMaterials.some((p) => n.toLowerCase().includes(p.toLowerCase())),
      );
      expect(matched.sort(), car.id).toEqual([...car.wheelSourceMaterials].sort());
      expect(matched.length, car.id).toBeLessThan(names.length);
    }
  });

  it('POST19: each built prototype height sits in the task bounds (hyper-a allows the antenna remnant up to 1.45)', async () => {
    for (const car of CARS) {
      const doc = await new NodeIO().read(join(ROOT, 'public', 'models', `${car.id}.glb`));
      const { min, max } = getBounds(doc.getRoot().listScenes()[0]);
      const height = max[1] - min[1];
      expect(height, car.id).toBeGreaterThanOrEqual(0.95);
      expect(height, car.id).toBeLessThanOrEqual(car.heightMax);
    }
  });
});

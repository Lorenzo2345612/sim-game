import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildCar } from '../../../tools/assets/buildCar';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'models');

const IN_SCOPE = ['lmp2-a', 'hyper-a'];
const BAD_IDS = ['sub/f4', 'f4 ', '.', ' ', 'f4.json'];
const AUTHOR_HANDLES = ['mosigana', 'supranakamura', 'kerdak123'];

interface WheelEntry {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface CarMeta {
  wheelRadius: number;
  wheelbase: number;
  trackFront: number;
  trackRear: number;
  wheels: WheelEntry[];
}

function readMeta(id: string): CarMeta {
  return JSON.parse(readFileSync(join(MODELS, `${id}.json`), 'utf8')) as CarMeta;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

describe('112 build contract gaps', () => {
  it('POST20: buildCar rejects empty, whitespace, dotted and path-like ids as unknown', async () => {
    for (const id of BAD_IDS) {
      await expect(buildCar(id), JSON.stringify(id)).rejects.toThrow(`unknown car id: ${id}`);
    }
  });

  it('POST21: every hub height is non-negative and sits within 5 cm of wheelRadius', () => {
    for (const id of IN_SCOPE) {
      const meta = readMeta(id);
      expect(meta.wheels, id).toHaveLength(4);
      for (const w of meta.wheels) {
        expect(w.y, `${id} ${w.name} y`).toBeGreaterThanOrEqual(0);
        expect(Math.abs(w.y - meta.wheelRadius), `${id} ${w.name} vs wheelRadius`).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('POST22: every json number is quantised to 6 decimals (round6 is a no-op)', () => {
    const scan = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        expect(round6(value), `${path} = ${value}`).toBe(value);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`);
      }
    };
    for (const id of IN_SCOPE) {
      scan(readMeta(id), id);
    }
  });

  it('POST23: outputs carry no source-author handles', () => {
    for (const id of IN_SCOPE) {
      const glb = readFileSync(join(MODELS, `${id}.glb`)).toString('latin1').toLowerCase();
      const json = readFileSync(join(MODELS, `${id}.json`), 'utf8').toLowerCase();
      for (const handle of AUTHOR_HANDLES) {
        expect(glb, `${id} glb ${handle}`).not.toContain(handle);
        expect(json, `${id} json ${handle}`).not.toContain(handle);
      }
    }
  });

  it('POST24: build:cars invokes the builder with no hardcoded car id list', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:cars']).toBe('tsx tools/assets/buildCar.ts');
  });
});

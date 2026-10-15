import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vehicle } from '../../../src/physics/vehicle';
import { VehicleModel } from '../../../src/physics/vehicleModel';

const ROOT = join(__dirname, '..', '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

describe('169 vehicle swap acceptance', () => {
  it('AT1: Vehicle is VehicleModel and no DynamicRayCastVehicleController remains in src', () => {
    expect(Vehicle as unknown).toBe(VehicleModel);
    const leftovers = walk(join(ROOT, 'src')).filter((path) =>
      readFileSync(path, 'utf8').includes('DynamicRayCastVehicleController'),
    );
    expect(leftovers).toEqual([]);
  });
});

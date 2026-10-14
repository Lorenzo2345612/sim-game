import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand } from '../../../src/core/types';
import { createGrandstand, seatPositions } from '../../../src/render/grandstand';

const ROOT = join(__dirname, '..', '..', '..');
const ATLAS_PNG = join(ROOT, 'public', 'textures', 'crowd', 'atlas.png');
const ATLAS_JSON = join(ROOT, 'public', 'textures', 'crowd', 'atlas.json');
const ATLAS_URL = '/textures/crowd/atlas.png';
const GRID = 8;
const CELL = 128;

const G: Grandstand = { x: 12, z: -34, yaw: 0.4, lengthMeters: 6, rows: 3, roof: false };

function crowdOf(group: THREE.Group): THREE.InstancedMesh {
  const crowd = group.getObjectByName('crowd');
  if (!(crowd instanceof THREE.InstancedMesh)) throw new Error('missing instanced mesh: crowd');
  return crowd;
}

function materialOf(crowd: THREE.InstancedMesh): THREE.MeshStandardMaterial {
  if (Array.isArray(crowd.material)) throw new Error('crowd material must not be an array');
  return crowd.material as THREE.MeshStandardMaterial;
}

function aCellOf(crowd: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const attr = crowd.geometry.attributes['aCell'];
  if (!(attr instanceof THREE.InstancedBufferAttribute)) throw new Error('missing aCell attribute');
  return attr;
}

function stubLoader(): (url: string) => THREE.Texture {
  return () => new THREE.Texture();
}

function nums(array: ArrayLike<number>): number[] {
  return Array.from(array);
}

describe('104 crowd post', () => {
  let png: Buffer;
  let meta: { cells: boolean[]; meanSaturation: number };

  beforeAll(() => {
    if (!existsSync(ATLAS_PNG) || !existsSync(ATLAS_JSON)) {
      execSync('npm run build:crowd', { cwd: ROOT, stdio: 'pipe', timeout: 540000 });
    }
    png = readFileSync(ATLAS_PNG);
    meta = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as typeof meta;
  }, 600000);

  it('POST1: atlas.json cells and meanSaturation match the atlas.png pixels (RGBA, all 64 cells filled)', async () => {
    const info = await sharp(png).metadata();
    expect(info.channels).toBe(4);
    expect(info.hasAlpha).toBe(true);
    const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
    expect(rgba.length).toBe(GRID * CELL * GRID * CELL * 4);

    expect(meta.cells).toHaveLength(GRID * GRID);
    for (const cell of meta.cells) expect(typeof cell).toBe('boolean');

    let satSum = 0;
    let satCount = 0;
    for (let cell = 0; cell < GRID * GRID; cell++) {
      const cellRow = Math.floor(cell / GRID);
      const cellCol = cell % GRID;
      let filled = false;
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          const i = ((cellRow * CELL + y) * GRID * CELL + cellCol * CELL + x) * 4;
          if (rgba[i + 3] === 0) continue;
          filled = true;
          const r = rgba[i] / 255;
          const g = rgba[i + 1] / 255;
          const b = rgba[i + 2] / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          satSum += max <= 0 ? 0 : (max - min) / max;
          satCount++;
        }
      }
      expect(filled, `cell ${cell} non-empty in png`).toBe(true);
      expect(meta.cells[cell], `cell ${cell} in atlas.json`).toBe(filled);
    }
    expect(satCount).toBeGreaterThan(0);
    expect(Math.abs(satSum / satCount - meta.meanSaturation)).toBeLessThan(1e-6);
  }, 120000);

  it('POST2: onBeforeCompile injects the aCell attribute and the (col,row)/8 uv offset; aCell holds integer grid cells', () => {
    const crowd = crowdOf(createGrandstand(G, stubLoader()));
    const material = materialOf(crowd);
    const patch = material.onBeforeCompile;
    expect(typeof patch).toBe('function');
    const shader = {
      vertexShader: 'A\n#include <common>\nB\n#include <uv_vertex>\nC',
      fragmentShader: '',
    } as unknown as Parameters<NonNullable<THREE.MeshStandardMaterial['onBeforeCompile']>>[0];
    patch(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('attribute vec2 aCell;');
    expect(shader.vertexShader).toContain('vMapUv += aCell / 8.0;');
    expect(shader.vertexShader.indexOf('attribute vec2 aCell;')).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <common>'),
    );
    expect(typeof material.customProgramCacheKey).toBe('function');
    expect(material.customProgramCacheKey!()).toBe(material.customProgramCacheKey!());

    const aCell = aCellOf(crowd);
    expect(aCell.itemSize).toBe(2);
    expect(aCell.count).toBe(crowd.count);
    for (const value of nums(aCell.array)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(GRID);
    }
  });

  it('POST3: atlas is addressed 1/8-scaled with row 0 at the png top and the quad upright (top of quad samples v = 0)', () => {
    const crowd = crowdOf(createGrandstand(G, stubLoader()));
    const map = materialOf(crowd).map;
    expect(map).toBeTruthy();
    expect(map!.flipY).toBe(false);
    expect(map!.repeat.x).toBeCloseTo(1 / GRID, 6);
    expect(map!.repeat.y).toBeCloseTo(1 / GRID, 6);
    const pos = crowd.geometry.attributes.position as THREE.BufferAttribute;
    const uv = crowd.geometry.attributes.uv as THREE.BufferAttribute;
    expect(pos.count).toBe(uv.count);
    for (let i = 0; i < pos.count; i++) {
      const top = pos.getY(i) > 0.45; // quad spans y 0..0.9 with the origin at the bottom centre
      expect(uv.getY(i)).toBeCloseTo(top ? 0 : 1, 6);
    }
  });

  it('POST4: crowd rng is seeded Math.round(x*31 + z*17) — equal seeds give identical crowds, other seeds do not', () => {
    const a: Grandstand = { x: 12, z: -34, yaw: 0.4, lengthMeters: 6, rows: 3, roof: false };
    const b: Grandstand = { x: -5, z: -3, yaw: -2.1, lengthMeters: 6, rows: 3, roof: true };
    const c: Grandstand = { x: 12, z: -35, yaw: 0.4, lengthMeters: 6, rows: 3, roof: false };
    expect(Math.round(a.x * 31 + a.z * 17)).toBe(Math.round(b.x * 31 + b.z * 17));

    const ca = crowdOf(createGrandstand(a, stubLoader()));
    const cb = crowdOf(createGrandstand(b, stubLoader()));
    const cc = crowdOf(createGrandstand(c, stubLoader()));
    expect(nums(cb.instanceMatrix.array)).toEqual(nums(ca.instanceMatrix.array));
    expect(nums(cb.instanceColor!.array)).toEqual(nums(ca.instanceColor!.array));
    expect(nums(aCellOf(cb).array)).toEqual(nums(aCellOf(ca).array));
    expect(nums(cc.instanceMatrix.array)).not.toEqual(nums(ca.instanceMatrix.array));
  });

  it('POST5: the default texture loader produces an SRGB map named after the atlas url', () => {
    const map = materialOf(crowdOf(createGrandstand(G))).map;
    expect(map).toBeTruthy();
    expect(map!.name).toBe(ATLAS_URL);
    expect(map!.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('POST6: fractional rows floor and degenerate dimensions create no crowd', () => {
    const frac: Grandstand = { x: 1, z: 1, yaw: 0, lengthMeters: 3, rows: 2.7, roof: false };
    expect(seatPositions(frac)).toEqual(seatPositions({ ...frac, rows: 2 }));
    expect(crowdOf(createGrandstand(frac, stubLoader())).count).toBe(
      Math.round(0.85 * 2 * Math.floor(3 / 0.6)),
    );
    const degenerate: Grandstand[] = [
      { x: 1, z: 1, yaw: 0, lengthMeters: -5, rows: 3, roof: false },
      { x: 1, z: 1, yaw: 0, lengthMeters: 6, rows: -2, roof: false },
    ];
    for (const g of degenerate) {
      expect(seatPositions(g)).toEqual([]);
      let instanced = 0;
      createGrandstand(g, stubLoader()).traverse((object) => {
        if (object instanceof THREE.InstancedMesh) instanced++;
      });
      expect(instanced).toBe(0);
    }
  });
});

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand } from '../../../src/core/types';
import { createGrandstand, seatPositions } from '../../../src/render/grandstand';

const ROOT = join(__dirname, '..', '..', '..');
const ATLAS_PNG = join(ROOT, 'public', 'textures', 'crowd', 'atlas.png');
const ATLAS_JSON = join(ROOT, 'public', 'textures', 'crowd', 'atlas.json');
const BUILD_TIMEOUT = 600000;

const CONFIGS: Grandstand[] = [
  { x: 12, z: -34, yaw: 0.4, lengthMeters: 30, rows: 10, roof: true },
  { x: -80, z: 5, yaw: -1.2, lengthMeters: 24, rows: 6, roof: false },
];

function buildCrowd(): void {
  execSync('npm run build:crowd', { cwd: ROOT, stdio: 'pipe', timeout: 540000 });
}

function atlasIhdr(png: Buffer): { chunk: string; width: number; height: number } {
  return {
    chunk: png.subarray(12, 16).toString('ascii'),
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

type AtlasMeta = { cells: boolean[]; meanSaturation: number };

function seatKey(p: { x: number; y: number; z: number }): string {
  return `${p.x},${p.y},${p.z}`;
}

function instancedMeshes(group: THREE.Group): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) meshes.push(object);
  });
  return meshes;
}

function translationsOf(crowd: THREE.InstancedMesh): Array<{ x: number; y: number; z: number }> {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < crowd.count; i++) {
    crowd.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    out.push({ x: position.x, y: position.y, z: position.z });
  }
  return out;
}

describe('104 crowd acceptance', () => {
  let firstPng: Buffer;
  let firstJson: Buffer;

  beforeAll(() => {
    buildCrowd();
    firstPng = readFileSync(ATLAS_PNG);
    firstJson = readFileSync(ATLAS_JSON);
  }, BUILD_TIMEOUT);

  it('AT1: build:crowd outputs a 1024x1024 atlas (8x8 cells of 128x128) with >= 48 non-empty cells and mean saturation < 0.35', () => {
    const { chunk, width, height } = atlasIhdr(readFileSync(ATLAS_PNG));
    expect(chunk).toBe('IHDR');
    expect(width).toBe(8 * 128);
    expect(height).toBe(8 * 128);
    const meta = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasMeta;
    expect(meta.cells).toHaveLength(8 * 8);
    expect(meta.cells.filter((cell) => cell).length).toBeGreaterThanOrEqual(48);
    expect(meta.meanSaturation).toBeLessThan(0.35);
  });

  it('AT2: running the build twice gives byte-identical atlas.png and atlas.json', () => {
    buildCrowd();
    expect(readFileSync(ATLAS_PNG).equals(firstPng)).toBe(true);
    expect(readFileSync(ATLAS_JSON).equals(firstJson)).toBe(true);
  }, BUILD_TIMEOUT);

  it('AT3: crowd has round(0.85 * rows * seatsPerRow) +/- 1 instances, each exactly on a seat position, one InstancedMesh per grandstand', () => {
    for (const g of CONFIGS) {
      const seatsPerRow = Math.floor(g.lengthMeters / 0.6);
      const expected = Math.round(0.85 * g.rows * seatsPerRow);
      const seats = seatPositions(g);
      expect(seats).toHaveLength(g.rows * seatsPerRow);
      const seatKeys = new Set(seats.map(seatKey));

      const meshes = instancedMeshes(createGrandstand(g, () => new THREE.Texture()));
      expect(meshes).toHaveLength(1);
      expect(meshes[0].name).toBe('crowd');
      const crowd = meshes[0];
      expect(Math.abs(crowd.count - expected)).toBeLessThanOrEqual(1);

      const positions = translationsOf(crowd);
      expect(new Set(positions.map(seatKey)).size).toBe(positions.length);
      for (const p of positions) expect(seatKeys.has(seatKey(p))).toBe(true);
    }
  });
});

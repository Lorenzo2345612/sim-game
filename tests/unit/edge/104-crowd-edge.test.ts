import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Grandstand } from '../../../src/core/types';
import { createGrandstand, disposeGrandstand, seatPositions } from '../../../src/render/grandstand';

const ATLAS_URL = '/textures/crowd/atlas.png';
const ROW_RISE = 0.8;
const ROW_DEPTH = 0.9;
const QUAD = 0.9;
const EPS = 1e-4;

// rows 2 x perRow 5: 0.85 * 2 * 5 = 8.5 exercises the count boundary too.
const G: Grandstand = { x: 12, z: -34, yaw: 0.4, lengthMeters: 3, rows: 2, roof: false };

function perRowOf(g: Grandstand): number {
  return Math.floor(g.lengthMeters / 0.6);
}

function recordingLoader(): { urls: string[]; textures: THREE.Texture[]; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  const textures: THREE.Texture[] = [];
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const texture = new THREE.Texture();
    textures.push(texture);
    return texture;
  };
  return { urls, textures, loadTexture };
}

function crowdOf(group: THREE.Group): THREE.InstancedMesh {
  const crowd = group.getObjectByName('crowd');
  if (!(crowd instanceof THREE.InstancedMesh)) throw new Error('missing instanced mesh: crowd');
  return crowd;
}

function materialOf(crowd: THREE.InstancedMesh): THREE.MeshStandardMaterial {
  if (Array.isArray(crowd.material)) throw new Error('crowd material must not be an array');
  return crowd.material as THREE.MeshStandardMaterial;
}

function matricesOf(crowd: THREE.InstancedMesh): THREE.Matrix4[] {
  const out: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < crowd.count; i++) {
    crowd.getMatrixAt(i, m);
    out.push(m.clone());
  }
  return out;
}

function positionsOf(crowd: THREE.InstancedMesh): Array<{ x: number; y: number; z: number }> {
  const p = new THREE.Vector3();
  return matricesOf(crowd).map((m) => {
    p.setFromMatrixPosition(m);
    return { x: p.x, y: p.y, z: p.z };
  });
}

describe('104 crowd edge', () => {
  it('EDGE1: seatPositions is row-major, y = tier top, z constant and increasing per row, x increasing within the length, local (independent of x/z/yaw)', () => {
    const g: Grandstand = { x: 5, z: -7, yaw: 0.3, lengthMeters: 7.5, rows: 3, roof: false };
    const perRow = perRowOf(g);
    expect(perRow).toBe(12);
    const seats = seatPositions(g);
    expect(seats).toHaveLength(g.rows * perRow);
    for (let row = 0; row < g.rows; row++) {
      const chunk = seats.slice(row * perRow, (row + 1) * perRow);
      const z = chunk[0].z;
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(g.rows * ROW_DEPTH + EPS);
      if (row > 0) expect(z).toBeGreaterThan(seats[(row - 1) * perRow].z + EPS);
      for (let i = 0; i < perRow; i++) {
        expect(chunk[i].y).toBeCloseTo((row + 1) * ROW_RISE, 6);
        expect(chunk[i].z).toBeCloseTo(z, 6);
        expect(Math.abs(chunk[i].x)).toBeLessThanOrEqual(g.lengthMeters / 2 + EPS);
        if (i > 0) expect(chunk[i].x).toBeGreaterThan(chunk[i - 1].x);
      }
    }
    expect(seatPositions({ ...g, x: g.x + 500, z: g.z - 300, yaw: g.yaw + 2 })).toEqual(seats);
  });

  it('EDGE2: crowd.count is exactly Math.round(0.85 * rows * perRow), half-up at .5', () => {
    const cases: Grandstand[] = [
      { x: 0, z: 0, yaw: 0, lengthMeters: 3, rows: 2, roof: false },
      { x: 1, z: 1, yaw: 0, lengthMeters: 30, rows: 10, roof: true },
      { x: 2, z: 2, yaw: 0, lengthMeters: 24, rows: 6, roof: false },
    ];
    for (const g of cases) {
      const crowd = crowdOf(createGrandstand(g, recordingLoader().loadTexture));
      expect(crowd.count).toBe(Math.round(0.85 * g.rows * perRowOf(g)));
    }
    expect(Math.round(0.85 * 2 * perRowOf(cases[0]))).toBe(9); // 8.5 rounds half-up
  });

  it('EDGE3: every instance is a 0.9 x 0.9 m quad facing local -Z with its bottom centre exactly on its seat', () => {
    const crowd = crowdOf(createGrandstand(G, recordingLoader().loadTexture));
    expect(crowd.count).toBeGreaterThan(0);
    const geometry = crowd.geometry;
    geometry.computeBoundingBox();
    const local = geometry.boundingBox!.clone();
    const normalAttr = geometry.attributes.normal as THREE.BufferAttribute;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const n = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    for (const m of matricesOf(crowd)) {
      pos.setFromMatrixPosition(m);
      box.copy(local).applyMatrix4(m);
      box.getSize(size);
      expect(size.x).toBeCloseTo(QUAD, 5);
      expect(size.y).toBeCloseTo(QUAD, 5);
      expect(size.z).toBeLessThan(1e-5);
      expect(box.min.y).toBeCloseTo(pos.y, 5);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(pos.x, 5);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(pos.z, 5);
      n.fromBufferAttribute(normalAttr, 0).applyMatrix3(nm.getNormalMatrix(m)).normalize();
      expect(n.x).toBeCloseTo(0, 5);
      expect(n.y).toBeCloseTo(0, 5);
      expect(n.z).toBeCloseTo(-1, 5);
    }
  });

  it('EDGE4: crowd material is MeshStandardMaterial with the atlas loaded once from the url (SRGB, name = url), alphaTest 0.5, roughness 0.9', () => {
    const { urls, textures, loadTexture } = recordingLoader();
    const crowd = crowdOf(createGrandstand(G, loadTexture));
    expect(urls).toEqual([ATLAS_URL]);
    const material = materialOf(crowd);
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.map).toBe(textures[0]);
    expect(material.map!.name).toBe(ATLAS_URL);
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.alphaTest).toBeCloseTo(0.5, 6);
    expect(material.roughness).toBeCloseTo(0.9, 6);
  });

  it('EDGE5: every instance tint has HSL saturation in [0.3, 0.6] and lightness in [0.45, 0.7]', () => {
    const crowd = crowdOf(createGrandstand(G, recordingLoader().loadTexture));
    const attr = crowd.instanceColor;
    expect(attr).toBeTruthy();
    const c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < crowd.count; i++) {
      c.fromBufferAttribute(attr!, i);
      c.getHSL(hsl);
      expect(hsl.s).toBeGreaterThanOrEqual(0.3 - EPS);
      expect(hsl.s).toBeLessThanOrEqual(0.6 + EPS);
      expect(hsl.l).toBeGreaterThanOrEqual(0.45 - EPS);
      expect(hsl.l).toBeLessThanOrEqual(0.7 + EPS);
    }
  });

  it('EDGE6: seat occupancy is seeded — identical order for equal grandstands, different seat set for different (x, z)', () => {
    const gA: Grandstand = { x: 12, z: -34, yaw: 0.4, lengthMeters: 6, rows: 3, roof: false };
    const gB: Grandstand = { ...gA, x: -80, z: 5 };
    const a1 = positionsOf(crowdOf(createGrandstand(gA, recordingLoader().loadTexture)));
    const a2 = positionsOf(crowdOf(createGrandstand(gA, recordingLoader().loadTexture)));
    expect(a2).toEqual(a1);
    const b = positionsOf(crowdOf(createGrandstand(gB, recordingLoader().loadTexture)));
    expect(b).not.toEqual(a1);
    const keys = (ps: typeof a1): Set<string> => new Set(ps.map((p) => `${p.x},${p.y},${p.z}`));
    expect(keys(b)).not.toEqual(keys(a1));
  });

  it('EDGE7: zero rows or zero seats per row creates no crowd mesh, empty seatPositions, and does not load the atlas', () => {
    const { urls, loadTexture } = recordingLoader();
    const cases: Grandstand[] = [
      { x: 1, z: 2, yaw: 0, lengthMeters: 12, rows: 0, roof: false },
      { x: 1, z: 2, yaw: 0, lengthMeters: 0.5, rows: 5, roof: false },
    ];
    for (const g of cases) {
      expect(seatPositions(g)).toEqual([]);
      const group = createGrandstand(g, loadTexture);
      expect(group.getObjectByName('crowd')).toBeUndefined();
      let instanced = 0;
      group.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) instanced++;
      });
      expect(instanced).toBe(0);
    }
    expect(urls).toEqual([]);
  });

  it('EDGE8: disposeGrandstand disposes the atlas texture exactly once', () => {
    const { textures, loadTexture } = recordingLoader();
    const group = createGrandstand(G, loadTexture);
    let disposed = 0;
    textures[0].addEventListener('dispose', () => {
      disposed++;
    });
    disposeGrandstand(group);
    expect(disposed).toBe(1);
    disposeGrandstand(group);
    expect(disposed).toBe(1);
  });

  it('EDGE9: seatPositions and createGrandstand do not mutate their input', () => {
    const g: Grandstand = { x: 3.25, z: -4.75, yaw: 0.9, lengthMeters: 9, rows: 4, roof: true };
    const snapshot = { ...g };
    Object.freeze(g);
    expect(() => seatPositions(g)).not.toThrow();
    expect(() => createGrandstand(g, recordingLoader().loadTexture)).not.toThrow();
    expect({ ...g }).toEqual(snapshot);
  });

  it('EDGE10: per-instance cell data is an InstancedBufferAttribute and the material is patched with onBeforeCompile', () => {
    const crowd = crowdOf(createGrandstand(G, recordingLoader().loadTexture));
    const instanced = Object.values(crowd.geometry.attributes).filter((a) => a instanceof THREE.InstancedBufferAttribute);
    expect(instanced.length).toBeGreaterThanOrEqual(1);
    for (const a of instanced) expect(a.count).toBe(crowd.count);
    expect(materialOf(crowd).onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile);
  });
});

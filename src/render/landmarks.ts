import * as THREE from 'three';
import type { LandmarkKind, TrackDataV2 } from '../core/types';

export interface LandmarkObject {
  group: THREE.Group;
  count: number;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function beam(a: THREE.Vector3, b: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, dir.length(), thick), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

function cylinderTower(h: number, g: THREE.Group): void {
  const stone = new THREE.MeshStandardMaterial({ color: 0xb79d70, roughness: 0.9 });
  const r = h * 0.2;
  g.add(mesh(new THREE.CylinderGeometry(r, r, h, 24), stone, 0, h / 2, 0));
}

function flameTowers(h: number, g: THREE.Group): void {
  const glass = new THREE.MeshStandardMaterial({ color: 0x5fa4b8, roughness: 0.2, metalness: 0.5 });
  const heights = [0.84, 0.92, 1];
  heights.forEach((f, i) => {
    const th = h * f;
    const geo = new THREE.CylinderGeometry(h * 0.03, h * 0.09, th, 8, 8);
    const p = geo.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const t = (p.getY(v) + th / 2) / th;
      p.setX(v, p.getX(v) + h * 0.06 * t * t);
      p.setY(v, p.getY(v) + th / 2);
    }
    geo.computeVertexNormals();
    g.add(mesh(geo, glass, (i - 1) * h * 0.22, 0, (i === 1 ? 1 : 0) * h * 0.1));
  });
}

function twinDeck(h: number, g: THREE.Group): void {
  const glass = new THREE.MeshStandardMaterial({ color: 0x7fb0d0, roughness: 0.2, metalness: 0.5 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.6 });
  const slab = new THREE.BoxGeometry(h * 0.14, h, h * 0.32);
  for (let i = -1; i <= 1; i++) g.add(mesh(slab, glass, i * h * 0.2, h / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(h * 1.6, h * 0.05, h * 0.16), deckMat, 0, h * 0.97, 0));
}

function wheel(h: number, g: THREE.Group): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x88b4d4, roughness: 0.2, metalness: 0.3 });
  const tube = h * 0.012;
  const R = h / 2 - tube;
  const cy = h / 2;
  g.add(mesh(new THREE.TorusGeometry(R, tube, 8, 48), steel, 0, cy, 0));
  const spoke = new THREE.BoxGeometry(tube * 0.6, R * 2, tube * 0.6);
  for (let i = 0; i < 6; i++) {
    const s = mesh(spoke, steel, 0, cy, 0);
    s.rotation.z = (i / 6) * Math.PI;
    g.add(s);
  }
  const cap = new THREE.CapsuleGeometry(h * 0.012, h * 0.02, 2, 6);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.add(mesh(cap, glass, Math.cos(a) * (R - h * 0.03), cy + Math.sin(a) * (R - h * 0.03), 0));
  }
  g.add(mesh(new THREE.BoxGeometry(h * 0.3, h * 0.04, h * 0.12), steel, 0, h * 0.02, 0));
}

function latticeTower(h: number, g: THREE.Group): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.6, metalness: 0.5 });
  const thick = h * 0.008;
  const levels = 5;
  const half = (t: number): number => h * (0.14 - 0.12 * t);
  const corner = (sx: number, sz: number, t: number): THREE.Vector3 =>
    new THREE.Vector3(sx * half(t), t * h * 0.99 + h * 0.005, sz * half(t));
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) g.add(beam(corner(sx, sz, 0), corner(sx, sz, 1), thick * 1.5, steel));
  for (let l = 0; l < levels; l++) {
    const t0 = l / levels;
    const t1 = (l + 1) / levels;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c];
      const [bx, bz] = corners[(c + 1) % 4];
      if (l > 0) g.add(beam(corner(ax, az, t0), corner(bx, bz, t0), thick, steel));
      g.add(beam(corner(ax, az, t0), corner(bx, bz, t1), thick, steel));
    }
  }
}

export function buildLandmark(kind: LandmarkKind, height: number): THREE.Group {
  const g = new THREE.Group();
  g.name = `landmark-${kind}`;
  if (kind === 'cylinder-tower') cylinderTower(height, g);
  else if (kind === 'flame-towers') flameTowers(height, g);
  else if (kind === 'twin-deck') twinDeck(height, g);
  else if (kind === 'wheel') wheel(height, g);
  else latticeTower(height, g);
  return g;
}

export function createLandmarks(
  track: TrackDataV2,
  terrainY: (x: number, z: number) => number,
): LandmarkObject {
  const group = new THREE.Group();
  group.name = 'landmarks';
  for (const l of track.landmarks ?? []) {
    const lm = buildLandmark(l.kind, l.height);
    lm.position.set(l.x, terrainY(l.x, l.z), l.z);
    lm.rotation.y = l.heading ?? 0;
    group.add(lm);
  }
  let disposed = false;
  return {
    group,
    count: track.landmarks?.length ?? 0,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const geos = new Set<THREE.BufferGeometry>();
      const mats = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        geos.add(m.geometry);
        mats.add(m.material as THREE.Material);
      });
      for (const geo of geos) geo.dispose();
      for (const mat of mats) mat.dispose();
    },
  };
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assignCells, chunkInstancedMesh, mergeStaticGroup } from '../../../src/render/chunking';
import { shadowConfig } from '../../../src/render/sceneSetup';
import type { Preset } from '../../../src/core/settings';

const CELL = 200;
const CHUNK = 500;

function box(x: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), material);
  mesh.position.set(x, 1, z);
  return mesh;
}

function instanced(points: { x: number; z: number }[], material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), material, points.length);
  const m = new THREE.Matrix4();
  points.forEach((p, i) => {
    m.makeTranslation(p.x, 1, p.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function translations(mesh: THREE.InstancedMesh): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    out.push({ x: p.x, z: p.z });
  }
  return out;
}

function coversVertices(geometry: THREE.BufferGeometry): boolean {
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere;
  if (!sphere) return false;
  const pos = geometry.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (sphere.distanceToPoint(v) > 1e-4) return false;
  }
  return true;
}

describe('152 render cost edge cases', () => {
  it('EDGE1: assignCells with empty input returns an empty map', () => {
    const cells = assignCells([], CELL);
    expect(cells.size).toBe(0);
  });

  it('EDGE2: assignCells does not mutate the input array or the position objects', () => {
    const positions = [
      { x: -0.5, z: 10 },
      { x: 250, z: -30 },
      { x: 199.999, z: 0 },
    ];
    const snapshot = JSON.stringify(positions);
    const refOrder = positions.map((p) => p);
    assignCells(positions, CELL);
    expect(JSON.stringify(positions)).toBe(snapshot);
    expect(positions.map((p) => p)).toEqual(refOrder);
    expect(positions[0]).toBe(refOrder[0]);
  });

  it('EDGE3: assignCells uses floor cell boundaries on exact multiples and negative fractions', () => {
    const positions = [
      { x: -200, z: -200 },
      { x: -0.5, z: 0 },
      { x: 0, z: 200 },
      { x: 200, z: -0.001 },
    ];
    const cells = assignCells(positions, CELL);
    expect(cells.has('-1,-1')).toBe(true);
    expect(cells.get('-1,-1')).toEqual([0]);
    expect(cells.get('-1,0')).toEqual([1]);
    expect(cells.get('0,1')).toEqual([2]);
    expect(cells.get('1,-1')).toEqual([3]);
    expect(cells.size).toBe(4);
  });

  it('EDGE4: assignCells iterates cells in first-appearance order with members in input order', () => {
    const positions = [
      { x: 450, z: 0 },
      { x: 10, z: 10 },
      { x: 460, z: 5 },
      { x: 20, z: 10 },
    ];
    const cells = assignCells(positions, CELL);
    expect([...cells.keys()]).toEqual(['2,0', '0,0']);
    expect(cells.get('2,0')).toEqual([0, 2]);
    expect(cells.get('0,0')).toEqual([1, 3]);
  });

  it('EDGE5: shadowConfig maps low/medium/high to {0,0}, {1024,1}, {2048,2}', () => {
    const presets: Preset[] = ['low', 'medium', 'high'];
    const expected = [
      { mapSize: 0, cascades: 0 },
      { mapSize: 1024, cascades: 1 },
      { mapSize: 2048, cascades: 2 },
    ];
    presets.forEach((preset, i) => {
      const cfg = shadowConfig(preset);
      expect(cfg.mapSize).toBe(expected[i].mapSize);
      expect(cfg.cascades).toBe(expected[i].cascades);
    });
  });

  it('EDGE6: mergeStaticGroup merges non-instanced meshes per material per 500 m XZ chunk with floor boundaries', () => {
    const matA = new THREE.MeshStandardMaterial({ color: '#aa0000' });
    const matB = new THREE.MeshStandardMaterial({ color: '#00aa00' });
    const group = new THREE.Group();
    group.add(box(100, 0, matA));
    group.add(box(300, 20, matA));
    group.add(box(150, 10, matB));
    group.add(box(-600, 0, matA));
    group.add(box(-500, 5, matA));

    const merged = mergeStaticGroup(group, CHUNK);
    const meshes = merged.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes.length).toBe(4);

    const withA = meshes.filter((m) => m.material === matA);
    const withB = meshes.filter((m) => m.material === matB);
    expect(withA.length).toBe(3);
    expect(withB.length).toBe(1);

    const cell0 = withA.find((m) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox as THREE.Box3;
      return bb.containsPoint(new THREE.Vector3(100, 1, 0));
    });
    expect(cell0).toBeDefined();
    expect((cell0 as THREE.Mesh).geometry.getAttribute('position').count).toBe(48);

    const negCells = withA.filter((m) => {
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox as THREE.Box3;
      return bb.max.x < -400;
    });
    expect(negCells.length).toBe(2);
  });

  it('EDGE7: mergeStaticGroup disposes source geometries and yields culled meshes with covering bounding spheres', () => {
    const mat = new THREE.MeshStandardMaterial({ color: '#0000aa' });
    const sources = [box(10, 10, mat), box(20, -30, mat), box(-10, 40, mat)];
    const disposed: boolean[] = sources.map(() => false);
    sources.forEach((s, i) => {
      s.geometry.addEventListener('dispose', () => {
        disposed[i] = true;
      });
    });
    const group = new THREE.Group();
    sources.forEach((s) => group.add(s));

    const merged = mergeStaticGroup(group, CHUNK);
    const meshes = merged.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    // Planner-authorised (152 round 1): floor cells (0,0), (0,-1), (-1,0) → one mesh per cell.
    expect(meshes.length).toBe(3);
    expect(disposed).toEqual([true, true, true]);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(true);
      expect(coversVertices(m.geometry)).toBe(true);
    }
  });

  it('EDGE8: chunkInstancedMesh splits instances into one shared-material mesh per 200 m cell', () => {
    const mat = new THREE.MeshStandardMaterial({ color: '#cccc00' });
    const points = [
      { x: -30, z: 5 },
      { x: -10, z: 5 },
      { x: 210, z: 30 },
      { x: 400, z: -200 },
    ];
    const mesh = instanced(points, mat);

    const cells = chunkInstancedMesh(mesh, CELL);
    expect(cells.children.length).toBe(3);

    const parts = cells.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(parts.length).toBe(3);
    const total = parts.reduce((n, p) => n + p.count, 0);
    expect(total).toBe(points.length);

    const seenCells = new Set<string>();
    for (const part of parts) {
      expect(part.material).toBe(mat);
      expect(part.frustumCulled).toBe(true);
      part.computeBoundingSphere();
      const sphere = part.boundingSphere;
      expect(sphere).not.toBeNull();
      const ts = translations(part);
      expect(ts.length).toBe(part.count);
      const keys = new Set(ts.map((t) => `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`));
      expect(keys.size).toBe(1);
      keys.forEach((k) => seenCells.add(k));
      const c = sphere as THREE.Sphere;
      for (const t of ts) {
        const d = new THREE.Vector3(t.x, 1, t.z).distanceTo(c.center);
        expect(d).toBeLessThanOrEqual(c.radius + 1e-4);
      }
    }
    expect([...seenCells].sort()).toEqual(['-1,0', '1,0', '2,-1']);
  });
});

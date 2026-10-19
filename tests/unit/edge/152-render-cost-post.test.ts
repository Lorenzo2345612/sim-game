import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { assignCells, chunkInstancedMesh, mergeStaticGroup } from '../../../src/render/chunking';

const CELL = 200;
const CHUNK = 500;

function box(x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), material);
  mesh.position.set(x, y, z);
  return mesh;
}

function meshChildren(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

function instancedAt(xs: number[], material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), material, xs.length);
  const m = new THREE.Matrix4();
  xs.forEach((x, i) => {
    mesh.setMatrixAt(i, m.makeTranslation(x, 1, 0));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function translationsOf(mesh: THREE.InstancedMesh): number[] {
  const out: number[] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(m.elements[12]);
  }
  return out;
}

describe('152 render cost post-pass gaps', () => {
  it('POST1: assignCells keeps exact floor keys at large magnitudes', () => {
    const cells = assignCells(
      [
        { x: 1e9, z: -1e9 },
        { x: 1e9 + 1, z: -1e9 - 1 },
        { x: 1e9 + 200, z: 0 },
      ],
      CELL,
    );
    expect([...cells.keys()]).toEqual(['5000000,-5000000', '5000000,-5000001', '5000001,0']);
    expect([...cells.values()]).toEqual([[0], [1], [2]]);
  });

  it('POST2: assignCells floors negative fractions at sub-unit cell sizes', () => {
    const cells = assignCells(
      [
        { x: 0.0005, z: 0 },
        { x: -0.0005, z: 0 },
      ],
      1e-3,
    );
    expect([...cells.keys()]).toEqual(['0,0', '-1,0']);
  });

  it('POST3: assignCells buckets identical positions into one cell in input order', () => {
    const positions = Array.from({ length: 5 }, () => ({ x: -37.25, z: 12.5 }));
    const cells = assignCells(positions, CELL);
    expect(cells.size).toBe(1);
    expect(cells.get('-1,0')).toEqual([0, 1, 2, 3, 4]);
  });

  it('POST4: mergeStaticGroup returns an empty group untouched', () => {
    const group = new THREE.Group();
    const out = mergeStaticGroup(group, CHUNK);
    expect(out).toBe(group);
    expect(group.children).toHaveLength(0);
  });

  it('POST5: mergeStaticGroup keeps merged geometry in group-local coordinates when the group is offset', () => {
    const mat = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    group.position.set(100, 0, 0);
    group.add(box(10, 1, 5, mat));

    mergeStaticGroup(group, CHUNK);

    const merged = meshChildren(group);
    expect(merged).toHaveLength(1);
    merged[0].geometry.computeBoundingBox();
    const bb = merged[0].geometry.boundingBox as THREE.Box3;
    expect(bb.containsPoint(new THREE.Vector3(10, 1, 5))).toBe(true);
    expect(bb.containsPoint(new THREE.Vector3(110, 1, 5))).toBe(false);
  });

  it('POST6: mergeStaticGroup merges every user of a shared geometry before disposing it', () => {
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(4, 2, 4);
    let disposed = false;
    geo.addEventListener('dispose', () => {
      disposed = true;
    });
    const a = new THREE.Mesh(geo, mat);
    a.position.set(100, 1, 0);
    const b = new THREE.Mesh(geo, mat);
    b.position.set(700, 1, 0);
    const group = new THREE.Group();
    group.add(a, b);

    mergeStaticGroup(group, CHUNK);

    expect(disposed).toBe(true);
    const merged = meshChildren(group);
    expect(merged).toHaveLength(2);
    for (const [m, point] of [
      [merged[0], new THREE.Vector3(100, 1, 0)],
      [merged[1], new THREE.Vector3(700, 1, 0)],
    ] as const) {
      m.geometry.computeBoundingBox();
      expect((m.geometry.boundingBox as THREE.Box3).containsPoint(point)).toBe(true);
    }
  });

  it('POST7: mergeStaticGroup leaves keep-list and per-instance-coloured instanced meshes intact', () => {
    const mat = new THREE.MeshStandardMaterial();
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), mat, 2);
    crowd.name = 'crowdGrandstand';
    const tyres = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), mat, 1);
    tyres.name = 'tyresStack';
    const coloured = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), mat, 1);
    coloured.name = 'kerbDecal';
    coloured.setColorAt(0, new THREE.Color(1, 0, 0));
    const group = new THREE.Group();
    group.add(crowd, tyres, coloured, box(0, 1, 0, mat));

    mergeStaticGroup(group, CHUNK);

    expect(group.children).toContain(crowd);
    expect(group.children).toContain(tyres);
    expect(group.children).toContain(coloured);
    expect(crowd.count).toBe(2);
    expect(coloured.instanceColor).not.toBeNull();
    expect(group.children).toHaveLength(4);
    expect(meshChildren(group).filter((m) => (m as THREE.InstancedMesh).isInstancedMesh !== true)).toHaveLength(1);
  });

  it('POST8: mergeStaticGroup bakes a plain static InstancedMesh into per-cell merges and disposes it', () => {
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(2, 2, 4);
    let geoDisposed = false;
    geo.addEventListener('dispose', () => {
      geoDisposed = true;
    });
    const inst = new THREE.InstancedMesh(geo, mat, 3);
    inst.name = 'kerbStrips';
    const m = new THREE.Matrix4();
    [10, 30, 600].forEach((x, i) => {
      inst.setMatrixAt(i, m.makeTranslation(x, 1, 0));
    });
    let instDisposed = false;
    inst.addEventListener('dispose', () => {
      instDisposed = true;
    });
    const group = new THREE.Group();
    group.add(inst);

    mergeStaticGroup(group, CHUNK);

    expect(geoDisposed).toBe(true);
    expect(instDisposed).toBe(true);
    expect(group.children.some((c) => (c as THREE.InstancedMesh).isInstancedMesh === true)).toBe(false);
    const merged = meshChildren(group);
    expect(merged).toHaveLength(2);
    const counts = merged
      .map((mesh) => mesh.geometry.getAttribute('position').count)
      .sort((a, b) => a - b);
    expect(counts).toEqual([24, 48]);
  });

  it('POST9: mergeStaticGroup propagates castShadow/receiveShadow from the merged members', () => {
    const mat = new THREE.MeshStandardMaterial();
    const cast = box(100, 1, 0, mat);
    cast.castShadow = true;
    const recv = box(100, 1, 20, mat);
    recv.receiveShadow = true;
    const plain = box(700, 1, 0, mat);
    const group = new THREE.Group();
    group.add(cast, recv, plain);

    mergeStaticGroup(group, CHUNK);

    const merged = meshChildren(group);
    expect(merged).toHaveLength(2);
    const near = merged.find((mesh) => {
      mesh.geometry.computeBoundingBox();
      return (mesh.geometry.boundingBox as THREE.Box3).containsPoint(new THREE.Vector3(100, 1, 0));
    });
    expect(near?.castShadow).toBe(true);
    expect(near?.receiveShadow).toBe(true);
    expect(merged.find((mesh) => mesh !== near)?.castShadow).toBe(false);
  });

  it('POST10: mergeStaticGroup skips skinned and multi-material meshes', () => {
    const matA = new THREE.MeshStandardMaterial();
    const matB = new THREE.MeshStandardMaterial();
    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(2, 2, 2), matA);
    const multi = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), [matA, matB]);
    const group = new THREE.Group();
    group.add(skinned, multi, box(0, 1, 0, matA));

    mergeStaticGroup(group, CHUNK);

    expect(group.children).toContain(skinned);
    expect(group.children).toContain(multi);
    expect(group.children).toHaveLength(3);
    const merged = meshChildren(group).filter((mesh) => mesh !== skinned && mesh !== multi);
    expect(merged).toHaveLength(1);
  });

  it('POST11: chunkInstancedMesh assigns cells from the base-transformed positions', () => {
    const mat = new THREE.MeshStandardMaterial();
    const mesh = instancedAt([0, 300], mat);
    const base = new THREE.Matrix4().makeTranslation(50, 0, 0);

    const cells = chunkInstancedMesh(mesh, CELL, base);

    const parts = cells.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(parts).toHaveLength(2);
    const keys = parts.map((part) => {
      const x = translationsOf(part)[0];
      return `${Math.floor(x / CELL)},0`;
    });
    expect(keys.sort()).toEqual(['0,0', '1,0']);
    const all = parts.flatMap(translationsOf).sort((a, b) => a - b);
    expect(all).toEqual([50, 350]);
  });

  it('POST12: chunkInstancedMesh of an empty mesh yields an empty group', () => {
    const mat = new THREE.MeshStandardMaterial();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), mat, 0);
    const cells = chunkInstancedMesh(mesh, CELL);
    expect(cells.children).toHaveLength(0);
  });

  it('POST13: chunkInstancedMesh slices instance colours to each cell membership', () => {
    const mat = new THREE.MeshStandardMaterial();
    const mesh = instancedAt([10, 60, 250], mat);
    mesh.setColorAt(0, new THREE.Color(1, 0, 0));
    mesh.setColorAt(1, new THREE.Color(0, 1, 0));
    mesh.setColorAt(2, new THREE.Color(0, 0, 1));

    const cells = chunkInstancedMesh(mesh, CELL);

    const parts = cells.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.instanceColor).not.toBeNull();
      expect(part.instanceColor!.count).toBe(part.count);
      for (let i = 0; i < part.count; i++) {
        const x = translationsOf(part)[i];
        const source = x < 30 ? 0 : x < 200 ? 1 : 2;
        const expected = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ][source];
        for (let c = 0; c < 3; c++) {
          expect(part.instanceColor!.getComponent(i, c)).toBeCloseTo(expected[c], 5);
        }
      }
    }
  });

  it('POST14: chunkInstancedMesh slices instanced attributes to each cell membership', () => {
    const mat = new THREE.MeshStandardMaterial();
    const geo = new THREE.BoxGeometry(2, 2, 2);
    geo.setAttribute(
      'atlas',
      new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 1, 1, 2, 1]), 2),
    );
    const mesh = new THREE.InstancedMesh(geo, mat, 3);
    const m = new THREE.Matrix4();
    [10, 60, 250].forEach((x, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(x, 1, 0));
    });

    const cells = chunkInstancedMesh(mesh, CELL);

    const parts = cells.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
    expect(parts).toHaveLength(2);
    const seen: number[] = [];
    for (const part of parts) {
      const atlas = part.geometry.getAttribute('atlas');
      expect(atlas.count).toBe(part.count);
      for (let i = 0; i < part.count; i++) {
        const x = translationsOf(part)[i];
        const source = x < 200 ? (x < 30 ? 0 : 1) : 2;
        expect(atlas.getX(i)).toBe(source);
        expect(atlas.getY(i)).toBe(1);
        seen.push(source);
      }
    }
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bucket key `${cx},${cz}` with cx = floor(x / cellSize); insertion order of first appearance. */
export function assignCells(
  positions: readonly { x: number; z: number }[],
  cellSize: number,
): Map<string, number[]> {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.z / cellSize)}`;
    const bucket = cells.get(key);
    if (bucket === undefined) cells.set(key, [i]);
    else bucket.push(i);
  }
  return cells;
}

interface MergeSource {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  rel: THREE.Matrix4;
  material: THREE.Material;
  cell: string;
  sig: string;
  merged: boolean;
}

function attributeSignature(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  return `${geometry.index !== null ? 'i' : 'n'}:${names.join(',')}`;
}

function cellKeyAt(x: number, z: number, chunkMeters: number): string {
  return `${Math.floor(x / chunkMeters)},${Math.floor(z / chunkMeters)}`;
}

// Fields that must stay instanced: per-spec list (crowd, tyres, foam) plus anything
// recoloured per instance (crowd/sausages) and TreeField's dynamic InstancedMesh2.
const KEEP_INSTANCED = /^(crowd|tyres|foam)/;

/** Meshes merged per material per XZ chunk; static instanced meshes baked into the merge. */
export function mergeStaticGroup(group: THREE.Group, chunkMeters: number): THREE.Group {
  group.updateWorldMatrix(true, false);
  const invGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const centre = new THREE.Vector3();
  const sources: MergeSource[] = [];
  const geometryUses = new Map<THREE.BufferGeometry, number>();
  const addSource = (source: MergeSource): void => {
    geometryUses.set(source.geometry, (geometryUses.get(source.geometry) ?? 0) + 1);
    sources.push(source);
  };

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh & {
      isInstancedMesh?: boolean;
      isSkinnedMesh?: boolean;
      isInstancedMesh2?: boolean;
    };
    if (!mesh.isMesh || mesh.isSkinnedMesh === true) return;
    if (Array.isArray(mesh.material) || mesh.material === undefined) return;
    const geometry = mesh.geometry;
    if (!geometry?.getAttribute('position')) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    mesh.updateWorldMatrix(true, false);
    const relBase = new THREE.Matrix4().multiplyMatrices(invGroup, mesh.matrixWorld);
    if (mesh.isInstancedMesh === true) {
      const inst = mesh as unknown as THREE.InstancedMesh & { isInstancedMesh2?: boolean };
      if (inst.isInstancedMesh2 === true || inst.instanceColor !== null) return;
      if (KEEP_INSTANCED.test(mesh.name)) return;
      const im = new THREE.Matrix4();
      const sig = attributeSignature(geometry);
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, im);
        im.premultiply(relBase);
        geometry.boundingBox!.getCenter(centre).applyMatrix4(im);
        addSource({
          mesh,
          geometry,
          rel: im.clone(),
          material: mesh.material,
          cell: cellKeyAt(centre.x, centre.z, chunkMeters),
          sig,
          merged: false,
        });
      }
      return;
    }
    // Cell from the local bounding-box centre moved into group space.
    geometry.boundingBox!.getCenter(centre).applyMatrix4(relBase);
    addSource({
      mesh,
      geometry,
      rel: relBase,
      material: mesh.material,
      cell: cellKeyAt(centre.x, centre.z, chunkMeters),
      sig: attributeSignature(geometry),
      merged: false,
    });
  });

  // Material + cell + attribute signature: mergeGeometries needs identical attribute sets.
  const buckets = new Map<string, THREE.BufferGeometry[]>();
  const byKey = new Map<string, MergeSource[]>();
  for (const source of sources) {
    const clone = source.geometry.clone();
    clone.applyMatrix4(source.rel);
    const key = `${source.material.uuid}|${source.cell}|${source.sig}`;
    const list = buckets.get(key);
    if (list === undefined) {
      buckets.set(key, [clone]);
      byKey.set(key, [source]);
    } else {
      list.push(clone);
      byKey.get(key)!.push(source);
    }
  }

  const produced: THREE.Mesh[] = [];
  const consumed = new Set<THREE.BufferGeometry>();
  for (const [key, geometries] of buckets) {
    const merged = mergeGeometries(geometries);
    if (merged === null) {
      for (const g of geometries) g.dispose();
      continue;
    }
    const members = byKey.get(key)!;
    const material = members[0].material;
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `merged:${material.name || 'mat'}:${members[0].cell}`;
    for (const member of members) {
      member.merged = true;
      mesh.castShadow = mesh.castShadow || member.mesh.castShadow;
      mesh.receiveShadow = mesh.receiveShadow || member.mesh.receiveShadow;
      consumed.add(member.geometry);
    }
    mesh.frustumCulled = true;
    produced.push(mesh);
  }

  const removed = new Set<THREE.Mesh>();
  for (const source of sources) {
    if (!source.merged || removed.has(source.mesh)) continue;
    source.mesh.removeFromParent();
    removed.add(source.mesh);
    if ((source.mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh === true) {
      (source.mesh as THREE.InstancedMesh).dispose();
    }
  }
  for (const geometry of consumed) {
    // Shared geometries stay alive until every user in the group is merged.
    let uses = 0;
    for (const source of sources) if (source.geometry === geometry) uses++;
    if (uses === geometryUses.get(geometry)) geometry.dispose();
  }
  for (const mesh of produced) group.add(mesh);
  return group;
}

function isInstancedAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): boolean {
  return (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute === true;
}

function hasInstancedAttributes(geometry: THREE.BufferGeometry, instanceCount: number): boolean {
  return Object.values(geometry.attributes).some(
    (a) => isInstancedAttribute(a) && a.count === instanceCount,
  );
}

// Per-instance attributes (e.g. crowd atlas cells) need a private clone sliced to the members.
function slicedGeometry(geometry: THREE.BufferGeometry, members: number[], instanceCount: number): THREE.BufferGeometry {
  const clone = geometry.clone();
  for (const [name, attribute] of Object.entries(clone.attributes)) {
    if (!isInstancedAttribute(attribute) || attribute.count !== instanceCount) continue;
    const data = new Float32Array(members.length * attribute.itemSize);
    for (let i = 0; i < members.length; i++) {
      for (let c = 0; c < attribute.itemSize; c++) {
        data[i * attribute.itemSize + c] = attribute.getComponent(members[i], c);
      }
    }
    clone.setAttribute(name, new THREE.InstancedBufferAttribute(data, attribute.itemSize));
  }
  return clone;
}

/** One InstancedMesh per XZ cell with its own bounding sphere; shares geometry and material. */
export function chunkInstancedMesh(
  mesh: THREE.InstancedMesh,
  cellSize: number,
  base?: THREE.Matrix4,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `${mesh.name || 'instanced'}:cells`;
  const count = mesh.count;
  const matrix = new THREE.Matrix4();
  const positions: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, matrix);
    if (base !== undefined) matrix.premultiply(base);
    positions.push({ x: matrix.elements[12], z: matrix.elements[14] });
  }
  const cells = assignCells(positions, cellSize);
  const privateGeometry = hasInstancedAttributes(mesh.geometry, count);
  for (const members of cells.values()) {
    const cell = new THREE.InstancedMesh(
      privateGeometry ? slicedGeometry(mesh.geometry, members, count) : mesh.geometry,
      mesh.material,
      members.length,
    );
    cell.name = `${mesh.name || 'instanced'}@${members.length}`;
    cell.castShadow = mesh.castShadow;
    cell.receiveShadow = mesh.receiveShadow;
    cell.renderOrder = mesh.renderOrder;
    cell.visible = mesh.visible;
    cell.frustumCulled = true;
    const matrices = new Float32Array(members.length * 16);
    for (let i = 0; i < members.length; i++) {
      mesh.getMatrixAt(members[i], matrix);
      if (base !== undefined) matrix.premultiply(base);
      matrix.toArray(matrices, i * 16);
    }
    cell.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
    if (mesh.instanceColor !== null) {
      const colors = new Float32Array(members.length * 3);
      for (let i = 0; i < members.length; i++) {
        for (let c = 0; c < 3; c++) colors[i * 3 + c] = mesh.instanceColor.getComponent(members[i], c);
      }
      cell.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    }
    cell.computeBoundingSphere();
    group.add(cell);
  }
  return group;
}

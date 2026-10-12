import * as THREE from 'three';
import type { Terrain } from '../core/types';

export function createTerrainMesh(terrain: Terrain, material?: THREE.Material): THREE.Mesh {
  const { originX, originZ, sizeX, sizeZ, rows, cols, heights } = terrain;
  const vertexCols = cols + 1;
  const vertexRows = rows + 1;
  if (heights.length !== vertexRows * vertexCols) {
    throw new Error('createTerrainMesh: invalid terrain');
  }

  const positions = new Float32Array(vertexRows * vertexCols * 3);
  const uvs = new Float32Array(vertexRows * vertexCols * 2);
  for (let i = 0; i <= rows; i++) {
    const z = originZ - sizeZ / 2 + (i * sizeZ) / rows;
    for (let j = 0; j <= cols; j++) {
      const x = originX - sizeX / 2 + (j * sizeX) / cols;
      const k = i * vertexCols + j;
      positions[k * 3] = x;
      positions[k * 3 + 1] = heights[j * vertexRows + i];
      positions[k * 3 + 2] = z;
      uvs[k * 2] = x / 10;
      uvs[k * 2 + 1] = z / 10;
    }
  }

  const indices = new Uint32Array(rows * cols * 6);
  let t = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * vertexCols + j;
      const b = a + vertexCols;
      indices[t++] = a;
      indices[t++] = b;
      indices[t++] = a + 1;
      indices[t++] = a + 1;
      indices[t++] = b;
      indices[t++] = b + 1;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    material ?? new THREE.MeshStandardMaterial({ color: 0x4a7a3a }),
  );
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

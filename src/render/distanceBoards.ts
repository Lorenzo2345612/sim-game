import * as THREE from 'three';
import type { Board, TrackDataV2 } from '../core/types';

export interface DistanceBoards { group: THREE.Group; count: number; dispose(): void }

const FACE_WIDTH = 1.2;
const FACE_HEIGHT = 0.8;
const FACE_CENTRE_Y = 1.2;   // face centre above the track elevation; also the post height
const POST_SIZE = 0.08;
const ATLAS_CELLS = 4;
const CELL_WIDTH = 192;
const CELL_HEIGHT = 128;
const LABELS: Board['label'][] = [200, 150, 100, 50];

function defaultAtlas(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH * ATLAS_CELLS;
  canvas.height = CELL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(CELL_HEIGHT * 0.62)}px sans-serif`;
    for (let k = 0; k < LABELS.length; k++) {
      ctx.fillText(String(LABELS[k]), (k + 0.5) * CELL_WIDTH, CELL_HEIGHT * 0.54);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Face cell `cell` of the shared atlas (cells run 200, 150, 100, 50 left to right).
function faceGeometry(cell: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(FACE_WIDTH, FACE_HEIGHT);
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setX(i, (cell + uv.getX(i)) / ATLAS_CELLS);
  }
  return geometry;
}

// Rotation with +Z opposite the travel direction (tx, tz) and +X across the track.
function faceRotation(tx: number, tz: number): THREE.Matrix4 {
  const len = Math.hypot(tx, tz);
  const inv = len < 1e-9 ? 0 : 1 / len;
  return new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-tz * inv, 0, tx * inv),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-tx * inv, 0, -tz * inv),
  );
}

export function createDistanceBoards(track: TrackDataV2, makeAtlas?: () => THREE.Texture): DistanceBoards {
  const group = new THREE.Group();
  const boards = track.boards ?? [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let atlas: THREE.Texture | null = null;

  if (boards.length > 0) {
    atlas = (makeAtlas ?? defaultAtlas)();
    const faceMaterial = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.9, metalness: 0 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.8, metalness: 0.1 });
    materials.push(faceMaterial, postMaterial);

    const centerline = track.centerline;
    const n = centerline.length;
    const postGeometry = new THREE.BoxGeometry(POST_SIZE, FACE_CENTRE_Y, POST_SIZE);
    geometries.push(postGeometry);
    const postMesh = new THREE.InstancedMesh(postGeometry, postMaterial, boards.length);
    const faces = new Map<Board['label'], THREE.Matrix4[]>();
    const matrix = new THREE.Matrix4();

    for (let k = 0; k < boards.length; k++) {
      const b = boards[k];
      const i = b.index;
      const prev = centerline[(i - 1 + n) % n];
      const next = centerline[(i + 1) % n];
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz);
      const tx = len < 1e-9 ? 0 : dx / len;
      const tz = len < 1e-9 ? -1 : dz / len;
      const nx = -tz;
      const nz = tx;
      const sign = b.side === 'right' ? 1 : -1;
      const y = track.elevation[i] ?? 0;
      const px = centerline[i][0] + nx * sign * b.offset;
      const pz = centerline[i][1] + nz * sign * b.offset;

      matrix.copy(faceRotation(tx, tz)).setPosition(px, y + FACE_CENTRE_Y, pz);
      const list = faces.get(b.label);
      if (list) list.push(matrix.clone());
      else faces.set(b.label, [matrix.clone()]);

      matrix.makeTranslation(px, y + FACE_CENTRE_Y / 2, pz);
      postMesh.setMatrixAt(k, matrix);
    }
    postMesh.instanceMatrix.needsUpdate = true;
    group.add(postMesh);

    for (let k = 0; k < LABELS.length; k++) {
      const list = faces.get(LABELS[k]);
      if (!list) continue;
      const geometry = faceGeometry(k);
      geometries.push(geometry);
      const mesh = new THREE.InstancedMesh(geometry, faceMaterial, list.length);
      for (let j = 0; j < list.length; j++) mesh.setMatrixAt(j, list[j]);
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  let disposed = false;
  return {
    group,
    count: boards.length,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      atlas?.dispose();
    },
  };
}

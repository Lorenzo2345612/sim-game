import * as THREE from 'three';
import type { TrackData } from '../core/types';

// Structural copy of RibbonGeometry (src/track/ribbon.ts); render must not import track.
export interface RibbonData {
  positions: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  vertexCount: number;
}

export interface TrackObject {
  group: THREE.Group;
  dispose(): void;
}

export function createTrackObject(
  ribbon: RibbonData,
  track: Pick<TrackData, 'centerline' | 'widthMeters'>,
): TrackObject {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(ribbon.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
  geometry.computeVertexNormals();

  // polygonOffset wins the depth test against the ground plane at grazing angles.
  const asphaltMaterial = new THREE.MeshStandardMaterial({
    color: '#3a3a3e',
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  const asphalt = new THREE.Mesh(geometry, asphaltMaterial);
  asphalt.name = 'asphalt';

  const [x0, z0] = track.centerline[0];
  const [x1, z1] = track.centerline[1];
  const yaw = Math.atan2(-(x1 - x0), -(z1 - z0));

  const startLineGeometry = new THREE.PlaneGeometry(track.widthMeters, 1.5);
  const startLineMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const startLine = new THREE.Mesh(startLineGeometry, startLineMaterial);
  startLine.name = 'startLine';
  startLine.position.set(x0, 0.03, z0);
  // YXZ: yaw about Y first, then lay the plane flat.
  startLine.rotation.order = 'YXZ';
  startLine.rotation.set(-Math.PI / 2, yaw, 0);

  const group = new THREE.Group();
  group.add(asphalt);
  group.add(startLine);

  return {
    group,
    dispose() {
      geometry.dispose();
      asphaltMaterial.dispose();
      startLineGeometry.dispose();
      startLineMaterial.dispose();
    },
  };
}

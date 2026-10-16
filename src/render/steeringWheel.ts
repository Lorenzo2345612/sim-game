import * as THREE from 'three';

const RIM_RADIAL_SEGMENTS = 12;
const RIM_TUBULAR_SEGMENTS = 48;
const SPOKE_ANGLES = [0, Math.PI, 1.5 * Math.PI]; // right, left, bottom
const TUBE_BASE = 0.012;
const TUBE_BASE_RADIUS = 0.13;

// Shared by every instance; disposeSteeringWheel must not release these.
let rimMaterial: THREE.MeshStandardMaterial | null = null;
let spokeMaterial: THREE.MeshStandardMaterial | null = null;
let displayMaterial: THREE.MeshStandardMaterial | null = null;

function sharedMaterials(): {
  rim: THREE.MeshStandardMaterial;
  spoke: THREE.MeshStandardMaterial;
  display: THREE.MeshStandardMaterial;
} {
  if (rimMaterial === null || spokeMaterial === null || displayMaterial === null) {
    rimMaterial = new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.6, roughness: 0.4 });
    spokeMaterial = new THREE.MeshStandardMaterial({ color: 0x262626, metalness: 0.4, roughness: 0.6 });
    displayMaterial = new THREE.MeshStandardMaterial({ color: 0x05070d, emissive: 0x0a1a33, roughness: 0.3 });
  }
  return { rim: rimMaterial, spoke: spokeMaterial, display: displayMaterial };
}

// Faces +Z in its local frame (towards the driver); the 20 deg column tilt is applied by the attacher.
export function createSteeringWheel(radius: number): THREE.Group {
  const group = new THREE.Group();
  const mats = sharedMaterials();
  const tube = TUBE_BASE * (radius / TUBE_BASE_RADIUS);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, RIM_RADIAL_SEGMENTS, RIM_TUBULAR_SEGMENTS),
    mats.rim,
  );
  group.add(rim);

  const spokeGeometry = new THREE.BoxGeometry(radius, tube * 2, tube * 2);
  for (const angle of SPOKE_ANGLES) {
    const spoke = new THREE.Mesh(spokeGeometry, mats.spoke);
    spoke.rotation.z = angle;
    spoke.position.set((Math.cos(angle) * radius) / 2, (Math.sin(angle) * radius) / 2, 0);
    group.add(spoke);
  }

  const display = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.42, radius * 0.3, tube * 2),
    mats.display,
  );
  display.position.z = tube * 1.5;
  group.add(display);

  return group;
}

export function setSteeringWheelAngle(group: THREE.Group, steer: number, lockDeg: number): void {
  const clamped = Math.min(1, Math.max(-1, steer));
  group.rotation.z = -clamped * (lockDeg / 2) * (Math.PI / 180);
}

export function disposeSteeringWheel(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
  group.clear();
}

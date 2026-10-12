import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Vec3 } from '../core/types';

export const FOG_TABLE: Record<string, { color: string; density: number }> = {
  monza: { color: '#b8c9d9', density: 0.00055 },
  spa: { color: '#9aa7b0', density: 0.0011 },
  silverstone: { color: '#a9b3bb', density: 0.0008 },
};

const SUN_ELEVATION_DEG = 35;
const SUN_AZIMUTH_DEG = 150;

function sunDirection(target: THREE.Vector3): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  return target.setFromSphericalCoords(1, phi, theta);
}

export function applyEnvironment(scene: THREE.Scene, trackId: string): void {
  const previous = scene.getObjectByName('sky');
  if (previous) {
    scene.remove(previous);
    const mesh = previous as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  const sky = new Sky();
  sky.name = 'sky';
  sky.scale.setScalar(4500);
  const uniforms = (sky.material as THREE.ShaderMaterial).uniforms;
  sunDirection(uniforms.sunPosition.value as THREE.Vector3);
  scene.add(sky);

  const fog = FOG_TABLE[trackId] ?? FOG_TABLE.monza;
  scene.fog = new THREE.FogExp2(fog.color, fog.density);
  scene.background = null;
}

const SUN_OFFSET = new THREE.Vector3(150, 200, 100);

export class ShadowRig {
  readonly light: THREE.DirectionalLight;

  constructor(scene: THREE.Scene) {
    this.light = new THREE.DirectionalLight('#ffffff', 2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0004;
    const cam = this.light.shadow.camera;
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    cam.near = 1;
    cam.far = 400;
    scene.add(this.light, this.light.target);
  }

  update(carPosition: Vec3): void {
    this.light.target.position.set(carPosition.x, carPosition.y, carPosition.z);
    this.light.position.set(
      carPosition.x + SUN_OFFSET.x,
      carPosition.y + SUN_OFFSET.y,
      carPosition.z + SUN_OFFSET.z,
    );
  }

  setEnabled(renderer: { shadowMap: { enabled: boolean } }, enabled: boolean): void {
    renderer.shadowMap.enabled = enabled;
    this.light.castShadow = enabled;
  }
}

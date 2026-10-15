import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { Vec3 } from '../core/types';

export const FOG_TABLE: Record<string, { density: number }> = {
  monza: { density: 0.00055 },
  spa: { density: 0.0011 },
  silverstone: { density: 0.0008 },
  mexico: { density: 0.0005 },
  daytona: { density: 0.0004 },
  lusail: { density: 0.0003 },
  bahrain: { density: 0.0003 },
  braselton: { density: 0.0005 },
  elkhart: { density: 0.0005 },
  sepang: { density: 0.0004 },
  baku: { density: 0.0004 },
  budapest: { density: 0.0005 },
  singapore: { density: 0.0005 },
  lasvegas: { density: 0.0003 },
  spielberg: { density: 0.0006 },
};

export const ENV_TABLE: Record<string, string> = {
  monza: 'kloofendal_48d_partly_cloudy_puresky',
  spa: 'kloofendal_overcast_puresky',
  silverstone: 'kloofendal_overcast_puresky',
  mexico: 'kloofendal_48d_partly_cloudy_puresky',
  daytona: 'kloofendal_48d_partly_cloudy_puresky',
  lusail: 'qwantani_noon_puresky',
  bahrain: 'qwantani_noon_puresky',
  braselton: 'kloofendal_48d_partly_cloudy_puresky',
  elkhart: 'kloofendal_48d_partly_cloudy_puresky',
  sepang: 'kloofendal_48d_partly_cloudy_puresky',
  baku: 'kloofendal_48d_partly_cloudy_puresky',
  budapest: 'kloofendal_48d_partly_cloudy_puresky',
  singapore: 'kloofendal_48d_partly_cloudy_puresky',
  lasvegas: 'qwantani_noon_puresky',
  spielberg: 'kloofendal_48d_partly_cloudy_puresky',
};

export interface EnvironmentInfo {
  name: string;
  horizon: [number, number, number];
}

const HORIZON_BAND_DEG = 5;

// Equirect RGBA float32 with row 0 = zenith; mean RGB over rows within ±5° of the horizon.
export function horizonColor(
  data: Float32Array,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let row = 0; row < height; row++) {
    const lat = (0.5 - (row + 0.5) / height) * 180;
    if (Math.abs(lat) > HORIZON_BAND_DEG) continue;
    const base = row * width * 4;
    for (let x = 0; x < width; x++) {
      const i = base + x * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
  }
  if (count === 0) return [0, 0, 0];
  return [r / count, g / count, b / count];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// The PMREM render target behind scene.environment, kept so a re-call can free it.
let environmentTarget: THREE.WebGLRenderTarget | null = null;

export async function applyEnvironment(
  scene: THREE.Scene,
  trackId: string,
  renderer: THREE.WebGLRenderer,
): Promise<EnvironmentInfo> {
  const oldSky = scene.getObjectByName('sky');
  if (oldSky) {
    scene.remove(oldSky);
    const mesh = oldSky as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  const name = ENV_TABLE[trackId] ?? ENV_TABLE.monza;
  const loader = new RGBELoader();
  loader.setDataType(THREE.FloatType);
  const texture = await loader.loadAsync(`/hdri/${name}_2k.hdr`);
  const image = texture.image as { data: Float32Array; width: number; height: number };
  const raw = horizonColor(image.data, image.width, image.height);
  const horizon: [number, number, number] = [clamp01(raw[0]), clamp01(raw[1]), clamp01(raw[2])];

  const previousBackground = scene.background;

  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
  scene.backgroundIntensity = 1;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  scene.environment = target.texture;
  scene.environmentIntensity = 0.7;

  environmentTarget?.dispose();
  environmentTarget = target;
  if (previousBackground instanceof THREE.Texture) previousBackground.dispose();

  const fog = FOG_TABLE[trackId] ?? FOG_TABLE.monza;
  scene.fog = new THREE.FogExp2(new THREE.Color(horizon[0], horizon[1], horizon[2]), fog.density);

  return { name, horizon };
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

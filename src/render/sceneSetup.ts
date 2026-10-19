import * as THREE from 'three';

export interface ShadowConfig {
  mapSize: number;
  cascades: number;
}

/** low: no shadow map; medium: one 1024 map; high: 2048 map plus a far cascade. */
export function shadowConfig(preset: 'low' | 'medium' | 'high'): ShadowConfig {
  switch (preset) {
    case 'low':
      return { mapSize: 0, cascades: 0 };
    case 'medium':
      return { mapSize: 1024, cascades: 1 };
    case 'high':
      return { mapSize: 2048, cascades: 2 };
  }
}

export interface SceneParts {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ground: THREE.Mesh;
  sun: THREE.DirectionalLight;
}

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  resize(width: number, height: number, camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

const SKY_COLOR = '#9ec9f0';

// White paint (track lines, kerb stripes, board panels, pit building) registered so the
// debug hook can verify the albedo cap; entries only need a linear `color`.
const whitePaint: { color: THREE.Color }[] = [];

export function registerWhitePaint(paint: { color: THREE.Color }): void {
  whitePaint.push(paint);
}

export function maxWhiteAlbedo(): number {
  let max = 0;
  for (const paint of whitePaint) {
    max = Math.max(max, paint.color.r, paint.color.g, paint.color.b);
  }
  return max;
}

export function createScene(): SceneParts {
  whitePaint.length = 0;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.backgroundIntensity = 0.85;
  scene.fog = new THREE.Fog(SKY_COLOR, 300, 2500);

  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.position.set(300, 500, 200);
  sun.castShadow = false;
  scene.add(sun);

  // Subdivided: a single 6 km triangle loses depth-interpolation precision on
  // software rasterizers and beats the 0.02 m asphalt in the depth test.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 128, 128),
    new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.name = 'ground';
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  camera.position.set(0, 5, 10);

  return { scene, camera, ground, sun };
}

export function createRenderer(canvas: HTMLCanvasElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // drawCalls/perfStats count the whole frame (scene + shadows + post passes); the app resets per frame.
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.85;

  return {
    renderer,
    resize(width, height, camera) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.dispose();
    },
  };
}

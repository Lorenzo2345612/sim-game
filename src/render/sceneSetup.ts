import * as THREE from 'three';

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

export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 300, 2500);

  scene.add(new THREE.HemisphereLight('#cfe8ff', '#5a7a3a', 0.8));

  const sun = new THREE.DirectionalLight('#ffffff', 2.0);
  sun.position.set(300, 500, 200);
  sun.castShadow = false;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

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

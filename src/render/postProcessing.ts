import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Preset } from '../core/settings';

export type PassName = 'render' | 'clamp' | 'gtao' | 'bloom' | 'lut' | 'smaa' | 'output';

const CHAINS: Record<Preset, PassName[]> = {
  low: [],
  medium: ['render', 'clamp', 'bloom', 'lut', 'smaa', 'output'],
  high: ['render', 'clamp', 'gtao', 'bloom', 'lut', 'smaa', 'output'],
};

// The HDRI sun overflows half-float (Inf -> NaN, spread by bloom as a white frame):
// NaN/±Inf comparisons fail the range test and become 0, finite values clamp to <= 64.
const CLAMP_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(
        (c.r >= -3.4e38 && c.r <= 3.4e38) ? min(c.r, 64.0) : 0.0,
        (c.g >= -3.4e38 && c.g <= 3.4e38) ? min(c.g, 64.0) : 0.0,
        (c.b >= -3.4e38 && c.b <= 3.4e38) ? min(c.b, 64.0) : 0.0,
        c.a
      );
    }
  `,
};

export function passesFor(tier: Preset): PassName[] {
  return CHAINS[tier];
}

export function parseCube(text: string): { size: number; data: Float32Array } {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sizeMatch = /^LUT_3D_SIZE\s+(\d+)$/.exec(line);
    if (sizeMatch !== null) {
      size = Number(sizeMatch[1]);
      continue;
    }
    if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX)\b/.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 3) throw new Error('parseCube: invalid');
    const r = Number(parts[0]);
    const g = Number(parts[1]);
    const b = Number(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error('parseCube: invalid');
    }
    values.push(r, g, b);
  }
  if (size <= 0 || values.length !== size * size * size * 3) throw new Error('parseCube: invalid');
  return { size, data: Float32Array.from(values) };
}

export interface PostProcessing {
  render(dt: number): void;
  resize(w: number, h: number): void;
  passes: PassName[];
  /** Live pass instance so hooks read the real strength/threshold, null when bloom is off. */
  bloom: UnrealBloomPass | null;
  dispose(): void;
}

// RGBA8: filterable everywhere in WebGL2; float 3D textures need OES_texture_float_linear.
function lutTexture(lut: { size: number; data: Float32Array }): THREE.Data3DTexture {
  const count = lut.size * lut.size * lut.size;
  const rgba = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const v = Math.round(lut.data[i * 3 + c] * 255);
      rgba[i * 4 + c] = Math.min(255, Math.max(0, v));
    }
    rgba[i * 4 + 3] = 255;
  }
  const texture = new THREE.Data3DTexture(rgba, lut.size, lut.size, lut.size);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  tier: Preset,
  lut: { size: number; data: Float32Array } | null,
): PostProcessing {
  const wanted = passesFor(tier);
  if (wanted.length === 0) {
    return {
      render: () => renderer.render(scene, camera),
      resize: () => {},
      passes: [],
      bloom: null,
      dispose: () => {},
    };
  }

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const created: Pass[] = [];
  const passes: PassName[] = [];
  let texture: THREE.Data3DTexture | null = null;
  let bloom: UnrealBloomPass | null = null;
  const add = (name: PassName, pass: Pass): void => {
    created.push(pass);
    composer.addPass(pass);
    passes.push(name);
  };

  for (const name of wanted) {
    switch (name) {
      case 'render':
        add('render', new RenderPass(scene, camera));
        break;
      case 'clamp':
        add('clamp', new ShaderPass(CLAMP_SHADER));
        break;
      case 'gtao':
        add('gtao', new GTAOPass(scene, camera, size.x, size.y));
        break;
      case 'bloom':
        // Threshold 1.0: only HDR highlights (emissives, the HDRI sun) bloom, not white paint.
        bloom = new UnrealBloomPass(size.clone(), 0.12, 0.4, 1.0);
        add('bloom', bloom);
        break;
      case 'lut':
        if (lut !== null) {
          texture = lutTexture(lut);
          add('lut', new LUTPass({ lut: texture, intensity: 1 }));
        }
        break;
      case 'smaa':
        add('smaa', new SMAAPass());
        break;
      case 'output':
        add('output', new OutputPass());
        break;
    }
  }

  return {
    render: (dt) => composer.render(dt),
    resize: (w, h) => composer.setSize(w, h),
    passes,
    bloom,
    dispose: () => {
      for (const pass of created) pass.dispose();
      texture?.dispose();
      composer.dispose();
    },
  };
}

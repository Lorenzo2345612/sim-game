import * as THREE from 'three';
import type { Surface, Vec3 } from '../core/types';

const G = 9.81;
const STONE_LIFE = 1.2;
const DUST_LIFE = 2.0;
const CLIPPING_LIFE = 1.0;
const MIN_EMISSION_SPEED = 3; // m/s
const DEFAULT_MAX = 600;
const HIDDEN_Y = -1e4;
const DUST_GROWTH = 1.5;
const TAU = Math.PI * 2;

const KIND_STONE = 0;
const KIND_DUST = 1;
const KIND_CLIPPING = 2;

const KIND_LIFE = [STONE_LIFE, DUST_LIFE, CLIPPING_LIFE];
const KIND_SIZE = [0.045, 0.22, 0.06];
// grey-beige stone, tan dust, green clipping
const KIND_COLOR = [
  [0.72, 0.68, 0.58],
  [0.78, 0.7, 0.54],
  [0.28, 0.55, 0.22],
];

const VERTEX_SHADER = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * (350.0 / -mv.z), 128.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  if (vAlpha <= 0.0) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

/** Particles per wheel per second; 0 below 3 m/s, non-finite speed or a hard surface. */
export function emissionRate(surface: Surface, speed: number): number {
  if (!Number.isFinite(speed) || speed < MIN_EMISSION_SPEED) return 0;
  if (surface === 'gravel') return 3 * speed;
  if (surface === 'grass') return 1.5 * speed;
  return 0;
}

export class SurfaceParticles {
  private readonly scene: THREE.Scene;
  private readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifes: Float32Array;
  private readonly kinds: Uint8Array;
  private readonly baseSizes: Float32Array;
  private readonly max: number;
  private head = 0;
  private used = 0; // slots above this were never written

  constructor(scene: THREE.Scene, maxParticles = DEFAULT_MAX) {
    this.scene = scene;
    this.max = Math.max(1, maxParticles);
    const n = this.max;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.ages = new Float32Array(n);
    this.lifes = new Float32Array(n);
    this.kinds = new Uint8Array(n);
    this.baseSizes = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const alphas = new Float32Array(n);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) this.positions[i * 3 + 1] = HIDDEN_Y;

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.geometry.setAttribute('aColor', this.colorAttr);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(surface: Surface, pos: Vec3, vel: Vec3, count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    if (surface === 'gravel') {
      const stones = Math.ceil(count / 2);
      this.spawn(KIND_STONE, stones, pos, vel);
      this.spawn(KIND_DUST, count - stones, pos, vel);
    } else if (surface === 'grass') {
      this.spawn(KIND_CLIPPING, count, pos, vel);
    }
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const pos = this.positions;
    const vel = this.velocities;
    const alphas = this.alphaAttr.array as Float32Array;
    const sizes = this.sizeAttr.array as Float32Array;
    for (let i = 0; i < this.used; i++) {
      const life = this.lifes[i];
      const age = this.ages[i];
      if (age >= life) continue;
      const next = age + dt;
      this.ages[i] = next;
      const j = i * 3;
      if (next >= life) {
        pos[j + 1] = HIDDEN_Y;
        alphas[i] = 0;
        continue;
      }
      if (this.kinds[i] !== KIND_DUST) vel[j + 1] -= G * dt;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      if (this.kinds[i] === KIND_DUST) {
        const t = next / life;
        alphas[i] = 1 - t;
        sizes[i] = this.baseSizes[i] * (1 + DUST_GROWTH * t);
      }
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) {
      if (this.ages[i] < this.lifes[i]) n++;
    }
    return n;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }

  private spawn(kind: number, count: number, pos: Vec3, vel: Vec3): void {
    const color = KIND_COLOR[kind];
    const posArr = this.positions;
    const velArr = this.velocities;
    const colors = this.colorAttr.array as Float32Array;
    const alphas = this.alphaAttr.array as Float32Array;
    const sizes = this.sizeAttr.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.max;
      if (i >= this.used) this.used = i + 1;
      const j = i * 3;
      const angle = Math.random() * TAU;
      const side = (Math.random() - 0.5) * 2;
      let rise: number;
      let drift: number;
      if (kind === KIND_DUST) {
        rise = 0.3 + Math.random() * 0.4;
        drift = 0.1 + Math.random() * 0.3;
      } else if (kind === KIND_CLIPPING) {
        rise = 0.5 + Math.random() * 0.9;
        drift = 0.3 + Math.random() * 0.6;
      } else {
        rise = 0.5 + Math.random() * 1.0;
        drift = 0.2 + Math.random() * 0.6;
      }
      posArr[j] = pos.x;
      posArr[j + 1] = pos.y;
      posArr[j + 2] = pos.z;
      velArr[j] = vel.x + Math.cos(angle) * side * drift;
      velArr[j + 1] = vel.y + rise;
      velArr[j + 2] = vel.z + Math.sin(angle) * side * drift;
      this.ages[i] = 0;
      this.lifes[i] = KIND_LIFE[kind];
      this.kinds[i] = kind;
      this.baseSizes[i] = KIND_SIZE[kind];
      const shade = 0.9 + Math.random() * 0.2;
      colors[j] = color[0] * shade;
      colors[j + 1] = color[1] * shade;
      colors[j + 2] = color[2] * shade;
      alphas[i] = 1;
      sizes[i] = KIND_SIZE[kind];
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}

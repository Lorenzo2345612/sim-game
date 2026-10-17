import * as THREE from 'three';
import { ACTION_BRAKE, ACTION_COAST, lineActions } from '../ai/lineActions';
import type { RacingLine } from '../ai/racingLine';
import type { DrivingLineMode } from '../core/settings';

const WIDTH = 0.6;
const LIFT = 0.02; // m above the sampled surface
const LOOKAHEAD_M = 200;
const OVERSHOOT_MS = 2; // profile speed below car speed − this turns red
const THROTTLE = new THREE.Color('#2ecc40');
const COAST = new THREE.Color('#ffdc00');
const BRAKE = new THREE.Color('#ff4136');

// Ribbon along the racing line, coloured by action; the dynamic red window
// (next 200 m where the profile is slower than the car) rewrites only colours.
export class DrivingLine {
  readonly object: THREE.Object3D;
  readonly vertexCount: number;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly colors: THREE.BufferAttribute;
  private readonly actions: Uint8Array;
  private readonly speeds: Float64Array;
  private readonly dist: Float64Array;
  private readonly length: number;
  private mode: DrivingLineMode = 'off';
  private carDistance = 0;
  private carSpeed = 0;

  constructor(line: RacingLine, speeds: Float64Array, y: (x: number, z: number) => number) {
    const pts = line.points;
    const n = pts.length / 2;
    this.actions = lineActions(speeds, line.dist, line.length);
    this.speeds = speeds;
    this.dist = line.dist;
    this.length = line.length;
    this.vertexCount = 4 * n;

    const positions = new Float32Array(4 * n * 3);
    const colors = new Float32Array(4 * n * 4);
    const indices = new Uint32Array(6 * n);
    const half = WIDTH / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[2 * i];
      const z0 = pts[2 * i + 1];
      const x1 = pts[2 * j];
      const z1 = pts[2 * j + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const nx = len > 1e-9 ? (-dz / len) * half : 0;
      const nz = len > 1e-9 ? (dx / len) * half : 0;
      const y0 = y(x0, z0) + LIFT;
      const y1 = y(x1, z1) + LIFT;
      const o = 12 * i;
      positions[o] = x0 - nx;
      positions[o + 1] = y0;
      positions[o + 2] = z0 - nz;
      positions[o + 3] = x0 + nx;
      positions[o + 4] = y0;
      positions[o + 5] = z0 + nz;
      positions[o + 6] = x1 + nx;
      positions[o + 7] = y1;
      positions[o + 8] = z1 + nz;
      positions[o + 9] = x1 - nx;
      positions[o + 10] = y1;
      positions[o + 11] = z1 - nz;
      const v = 4 * i;
      const q = 6 * i;
      indices[q] = v;
      indices[q + 1] = v + 1;
      indices[q + 2] = v + 2;
      indices[q + 3] = v;
      indices[q + 4] = v + 2;
      indices[q + 5] = v + 3;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colors = new THREE.BufferAttribute(colors, 4);
    this.geometry.setAttribute('color', this.colors);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.visible = false;
    this.rewriteColors();
  }

  setMode(mode: DrivingLineMode): void {
    this.mode = mode;
    this.object.visible = mode !== 'off';
    this.rewriteColors();
  }

  update(carDistance: number, carSpeed: number): void {
    this.carDistance = carDistance;
    this.carSpeed = carSpeed;
    if (this.mode === 'off') return;
    this.rewriteColors();
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  // Full colour-buffer rewrite: base action colour, alpha 0 when the mode hides
  // the segment, dynamic red inside the lookahead window. No allocation.
  private rewriteColors(): void {
    const arr = this.colors.array as Float32Array;
    const n = this.actions.length;
    for (let i = 0; i < n; i++) {
      const ahead = (((this.dist[i] - this.carDistance) % this.length) + this.length) % this.length;
      const red =
        (ahead < LOOKAHEAD_M && this.speeds[i] < this.carSpeed - OVERSHOOT_MS) ||
        this.actions[i] === ACTION_BRAKE;
      const shown = this.mode === 'full' || red;
      const c = red ? BRAKE : this.actions[i] === ACTION_COAST ? COAST : THROTTLE;
      const r = shown ? c.r : 0;
      const g = shown ? c.g : 0;
      const b = shown ? c.b : 0;
      const a = shown ? 1 : 0;
      const o = 16 * i;
      for (let v = 0; v < 4; v++) {
        const p = o + 4 * v;
        arr[p] = r;
        arr[p + 1] = g;
        arr[p + 2] = b;
        arr[p + 3] = a;
      }
    }
    this.colors.needsUpdate = true;
  }
}

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SurfaceParticles, emissionRate } from '../../../src/render/surfaceParticles';
import type { Surface, Vec3 } from '../../../src/core/types';

function emit(particles: SurfaceParticles, surface: Surface, y: number, count: number): void {
  const pos: Vec3 = { x: 0, y, z: 0 };
  const vel: Vec3 = { x: 0, y: 0, z: 0 };
  particles.emit(surface, pos, vel, count);
}

function pooledPoints(scene: THREE.Scene): THREE.Points {
  return scene.children[0] as THREE.Points;
}

function readYs(attribute: THREE.BufferAttribute): Float64Array {
  const ys = new Float64Array(attribute.count);
  for (let i = 0; i < attribute.count; i++) ys[i] = attribute.array[i * 3 + 1];
  return ys;
}

describe('167 surface particles acceptance', () => {
  it('AT1: emissionRate is 60 / 30 / 0 / 0 / 0 / 0 for the listed surface-speed pairs', () => {
    expect(emissionRate('gravel', 20)).toBeCloseTo(60, 9);
    expect(emissionRate('grass', 20)).toBeCloseTo(30, 9);
    expect(emissionRate('gravel', 2)).toBeCloseTo(0, 9);
    expect(emissionRate('asphalt', 50)).toBeCloseTo(0, 9);
    expect(emissionRate('kerb', 50)).toBeCloseTo(0, 9);
    expect(emissionRate('grass', NaN)).toBeCloseTo(0, 9);
  });

  it('AT2: constructor adds exactly one child to the scene and starts with aliveCount 0', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    expect(scene.children).toHaveLength(1);
    expect(particles.aliveCount()).toBe(0);
  });

  it('AT3: emit gravel 100 into a pool of 600 gives aliveCount 100', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'gravel', 0, 100);
    expect(particles.aliveCount()).toBe(100);
  });

  it('AT4: after AT3, update(1/60) for 2.1 s gives aliveCount 0', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'gravel', 0, 100);
    // 126 × 1/60 s = 2.1 s, past the 2.0 s dust life.
    for (let i = 0; i < 126; i++) particles.update(1 / 60);
    expect(particles.aliveCount()).toBe(0);
  });

  it('AT5: emit grass 1000 into a pool of 600 caps at aliveCount 600 without throwing', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'grass', 0, 1000);
    expect(particles.aliveCount()).toBe(600);
  });

  it('AT6: asphalt, kerb and runoff emits are ignored (aliveCount stays 0)', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'asphalt', 0, 50);
    emit(particles, 'kerb', 0, 50);
    emit(particles, 'runoff', 0, 50);
    expect(particles.aliveCount()).toBe(0);
  });

  it('AT7: gravel stones emitted at y = 1 with zero velocity end below y 1 and finite, and the position array is never reallocated', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'gravel', 1, 100);
    const attribute = pooledPoints(scene).geometry.getAttribute('position') as THREE.BufferAttribute;
    const before = attribute.array;

    const frames: Float64Array[] = [readYs(attribute)];
    for (let k = 0; k < 30; k++) {
      particles.update(1 / 60);
      frames.push(readYs(attribute));
    }

    let stones = 0;
    for (let i = 0; i < attribute.count; i++) {
      // Ballistic signature: second difference of y equals -g·dt² ≈ -0.00273,
      // while dust rises at a roughly constant slow speed (second difference ≈ 0).
      let ballistic = false;
      for (let k = 1; k + 1 < frames.length; k++) {
        const d2 = frames[k + 1][i] - 2 * frames[k][i] + frames[k - 1][i];
        if (d2 <= -0.0015) {
          ballistic = true;
          break;
        }
      }
      if (!ballistic) continue;
      stones++;
      const y = frames[frames.length - 1][i];
      expect(Number.isFinite(y), `stone ${i} y finite`).toBe(true);
      expect(y, `stone ${i} final y`).toBeLessThan(1);
    }
    expect(stones, 'ballistic stones found').toBeGreaterThan(0);
    expect(attribute.array).toBe(before);
  });

  it('AT8: dispose removes the object from the scene and calls geometry.dispose and material.dispose once each', () => {
    const scene = new THREE.Scene();
    const particles = new SurfaceParticles(scene, 600);
    emit(particles, 'gravel', 0, 50);
    const object = pooledPoints(scene);
    const geometryDispose = vi.spyOn(object.geometry, 'dispose');
    const materialDispose = vi.spyOn(object.material as THREE.Material, 'dispose');
    particles.dispose();
    expect(scene.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});

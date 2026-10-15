import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LIVERY_PATTERNS, type Livery } from '../../../src/game/livery';
import { applyLivery, liveryColorAt } from '../../../src/render/liveryMaterial';

const BOUNDS = new THREE.Box3(new THREE.Vector3(-1, 0, -2.5), new THREE.Vector3(1, 1.5, 2.5));

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

function livery(overrides: Partial<Livery> = {}): Livery {
  return { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', pattern: 'stripe', number: 7, ...overrides };
}

function buildCar(): { root: THREE.Group; paint: THREE.MeshStandardMaterial; other: THREE.MeshStandardMaterial; paintMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>; otherMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> } {
  const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
  const other = new THREE.MeshStandardMaterial({ name: 'glass' });
  const paintMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), paint);
  const otherMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), other);
  const root = new THREE.Group();
  root.add(paintMesh, otherMesh);
  return { root, paint, other, paintMesh, otherMesh };
}

function uniformsOf(mat: THREE.MeshStandardMaterial): Record<string, { value: unknown }> {
  const shader = fakeShader();
  mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

describe('120 livery shader edge cases', () => {
  it('EDGE1: solid pattern returns primary (0) for any u, v, h', () => {
    expect(liveryColorAt('solid', 0.5, 0.5, 0.5)).toBe(0);
    expect(liveryColorAt('solid', 0, 0, 0)).toBe(0);
    expect(liveryColorAt('solid', 1, 1, 1)).toBe(0);
    expect(liveryColorAt('solid', -1, 2, 0.5)).toBe(0);
  });

  it('EDGE2: stripe keeps strict half-widths 0.08 and 0.1 on both sides of u=0.5', () => {
    expect(liveryColorAt('stripe', 0.43, 0.9, 0.1)).toBe(1);
    expect(liveryColorAt('stripe', 0.57, 0.1, 0.9)).toBe(1);
    expect(liveryColorAt('stripe', 0.415, 0.5, 0.5)).toBe(2);
    expect(liveryColorAt('stripe', 0.585, 0.5, 0.5)).toBe(2);
    expect(liveryColorAt('stripe', 0.39, 0.5, 0.5)).toBe(0);
    expect(liveryColorAt('stripe', 0.61, 0.5, 0.5)).toBe(0);
  });

  it('EDGE3: split tests h > 0.55 strictly and ignores u and v', () => {
    expect(liveryColorAt('split', 0.2, 0.3, 0.55)).toBe(0);
    expect(liveryColorAt('split', 0.2, 0.3, 0.56)).toBe(1);
    expect(liveryColorAt('split', 0.9, 0.1, 0.99)).toBe(1);
    expect(liveryColorAt('split', 0, 0, 0)).toBe(0);
  });

  it('EDGE4: chevron wedge follows v < 0.35 and |u-0.5| < 0.35-v strictly', () => {
    expect(liveryColorAt('chevron', 0.5, 0, 0.5)).toBe(1);
    expect(liveryColorAt('chevron', 0.84, 0, 0.5)).toBe(1);
    expect(liveryColorAt('chevron', 0.16, 0, 0.5)).toBe(1);
    expect(liveryColorAt('chevron', 0.86, 0, 0.5)).toBe(0);
    expect(liveryColorAt('chevron', 0.14, 0, 0.5)).toBe(0);
    expect(liveryColorAt('chevron', 0.5, 0.35, 0.5)).toBe(0);
    expect(liveryColorAt('chevron', 0.55, 0.2, 0.5)).toBe(1);
    expect(liveryColorAt('chevron', 0.3, 0.2, 0.5)).toBe(0);
  });

  it('EDGE5: u, v and h are not clamped to 0..1', () => {
    expect(liveryColorAt('stripe', 1.5, 0, 0)).toBe(0);
    expect(liveryColorAt('stripe', -1.5, 0, 0)).toBe(0);
    expect(liveryColorAt('stripe', 0.5, -10, 10)).toBe(1);
    expect(liveryColorAt('split', 0, 0, 2)).toBe(1);
    expect(liveryColorAt('split', 0, 0, -0.5)).toBe(0);
    expect(liveryColorAt('chevron', 0.5, -0.2, 0)).toBe(1);
    expect(liveryColorAt('chevron', 0.5, 1, 0)).toBe(0);
  });

  it('EDGE6: re-applying updates uniforms in place without cloning the material again', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery({ pattern: 'stripe', primary: '#ff0000' }), BOUNDS);
    const mat = car.paintMesh.material;
    const before = uniformsOf(mat);
    const beforePrimary = snapshot(before.uPrimary.value);
    expect(before.uPattern.value).toBe(LIVERY_PATTERNS.indexOf('stripe'));

    applyLivery(car.root, ['livery'], livery({ pattern: 'split', primary: '#0000ff', number: 9 }), BOUNDS);
    expect(car.paintMesh.material).toBe(mat);
    const after = uniformsOf(mat);
    expect(after.uPattern.value).toBe(LIVERY_PATTERNS.indexOf('split'));
    expect(snapshot(after.uPrimary.value)).not.toBe(beforePrimary);
  });

  it('EDGE7: missing material names and an empty paintMaterials list are silent no-ops', () => {
    const car = buildCar();
    expect(() => applyLivery(car.root, ['nope'], livery(), BOUNDS)).not.toThrow();
    expect(() => applyLivery(car.root, [], livery(), BOUNDS)).not.toThrow();
    expect(car.paintMesh.material).toBe(car.paint);
    expect(car.otherMesh.material).toBe(car.other);
    expect(Object.keys(uniformsOf(car.paint))).toEqual([]);
  });

  it('EDGE8: paint meshes nested below the root are painted too', () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), paint);
    const child = new THREE.Group();
    child.add(mesh);
    const root = new THREE.Group();
    root.add(child);
    applyLivery(root, ['livery'], livery(), BOUNDS);
    expect(mesh.material).not.toBe(paint);
    expect(Object.keys(uniformsOf(mesh.material as THREE.MeshStandardMaterial))).toContain('uPrimary');
  });

  it('EDGE9: two cars with different liveries get distinct clones and distinct uniform values', () => {
    const carA = buildCar();
    const carB = buildCar();
    applyLivery(carA.root, ['livery'], livery({ pattern: 'stripe', primary: '#ff0000' }), BOUNDS);
    applyLivery(carB.root, ['livery'], livery({ pattern: 'chevron', primary: '#0000ff' }), BOUNDS);
    const matA = carA.paintMesh.material;
    const matB = carB.paintMesh.material;
    expect(matA).not.toBe(matB);
    const uA = uniformsOf(matA);
    const uB = uniformsOf(matB);
    expect(snapshot(uA.uPrimary.value)).not.toBe(snapshot(uB.uPrimary.value));
    expect(uA.uPattern.value).toBe(LIVERY_PATTERNS.indexOf('stripe'));
    expect(uB.uPattern.value).toBe(LIVERY_PATTERNS.indexOf('chevron'));
  });

  it('EDGE10: uPattern is the LIVERY_PATTERNS index for every pattern', () => {
    LIVERY_PATTERNS.forEach((pattern, i) => {
      const car = buildCar();
      applyLivery(car.root, ['livery'], livery({ pattern }), BOUNDS);
      expect(uniformsOf(car.paintMesh.material).uPattern.value, pattern).toBe(i);
    });
  });
});

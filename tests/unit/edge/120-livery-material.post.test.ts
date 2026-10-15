import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Livery, LiveryPattern } from '../../../src/game/livery';
import { applyLivery, liveryColorAt, liveryPrimaryOf } from '../../../src/render/liveryMaterial';

const BOUNDS = new THREE.Box3(new THREE.Vector3(-1, 0, -2.5), new THREE.Vector3(1, 1.5, 2.5));
const MOVED = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 3, 4));
const FLAT = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 4));
const POINT = new THREE.Box3(new THREE.Vector3(1, 1, 1), new THREE.Vector3(1, 1, 1));

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

function uniformsOf(mat: THREE.Material): Record<string, { value: unknown }> {
  const shader = fakeShader();
  (mat as THREE.MeshStandardMaterial).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader.uniforms;
}

function colorU(mat: THREE.Material, key: string): string {
  return (uniformsOf(mat)[key].value as THREE.Color).getHexString();
}

function vecU(mat: THREE.Material, key: string): THREE.Vector3 {
  return uniformsOf(mat)[key].value as THREE.Vector3;
}

function patternU(mat: THREE.Material): number {
  return uniformsOf(mat).uPattern.value as number;
}

function buildCar(): { root: THREE.Group; paint: THREE.MeshStandardMaterial; paintMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> } {
  const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
  const paintMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), paint);
  const root = new THREE.Group();
  root.add(paintMesh);
  return { root, paint, paintMesh };
}

describe('120 livery material post checks', () => {
  it('POST1: liveryPrimaryOf reads the applied primary back lower case, null without paint', () => {
    const car = buildCar();
    expect(liveryPrimaryOf(car.root)).toBeNull();
    applyLivery(car.root, ['nope'], livery(), BOUNDS);
    expect(liveryPrimaryOf(car.root)).toBeNull();
    applyLivery(car.root, ['livery'], livery({ primary: '#AA0055' }), BOUNDS);
    expect(liveryPrimaryOf(car.root)).toBe('#aa0055');
    applyLivery(car.root, ['livery'], livery({ primary: '#00FF00', pattern: 'split' }), BOUNDS);
    expect(liveryPrimaryOf(car.root)).toBe('#00ff00');
  });

  it('POST2: the uniforms carry the livery primary, secondary and accent colours', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery({ primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' }), BOUNDS);
    const mat = car.paintMesh.material;
    expect(colorU(mat, 'uPrimary')).toBe('ff0000');
    expect(colorU(mat, 'uSecondary')).toBe('00ff00');
    expect(colorU(mat, 'uAccent')).toBe('0000ff');
  });

  it('POST3: only the paint slot of a multi-material mesh is replaced', () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
    const glass = new THREE.MeshStandardMaterial({ name: 'glass' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [paint, glass]);
    const root = new THREE.Group();
    root.add(mesh);
    applyLivery(root, ['livery'], livery(), BOUNDS);
    const mats = mesh.material as THREE.Material[];
    expect(mats).toHaveLength(2);
    expect(mats[0]).not.toBe(paint);
    expect(mats[1]).toBe(glass);
    expect(Object.keys(uniformsOf(mats[0]))).toContain('uPrimary');
    expect(Object.keys(uniformsOf(mats[1]))).toEqual([]);
  });

  it('POST4: a non-standard material named in paintMaterials is left untouched', () => {
    const basic = new THREE.MeshBasicMaterial({ name: 'livery' });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), basic);
    const root = new THREE.Group();
    root.add(mesh);
    expect(() => applyLivery(root, ['livery'], livery(), BOUNDS)).not.toThrow();
    expect(mesh.material).toBe(basic);
    expect(basic.color.getHexString()).toBe('ffffff');
  });

  it('POST5: the paint clone drops metalness, keeps the base map and leaves the original alone', () => {
    const tex = new THREE.Texture();
    const paint = new THREE.MeshStandardMaterial({ name: 'livery', metalness: 1, map: tex });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
    const root = new THREE.Group();
    root.add(mesh);
    applyLivery(root, ['livery'], livery(), BOUNDS);
    const clone = mesh.material as THREE.MeshStandardMaterial;
    expect(clone).not.toBe(paint);
    expect(clone.metalness).toBe(0);
    expect(paint.metalness).toBe(1);
    expect(clone.map).toBe(tex);
  });

  it('POST6: meshes sharing one paint material in a call share one clone', () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
    const m1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
    const m2 = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), paint);
    const root = new THREE.Group();
    root.add(m1, m2);
    applyLivery(root, ['livery'], livery(), BOUNDS);
    expect(m1.material).toBe(m2.material);
    expect(m1.material).not.toBe(paint);
    expect(Object.keys(uniformsOf(m1.material as THREE.Material))).toContain('uPrimary');
  });

  it('POST7: two roots sharing one original material still get distinct clones', () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
    const meshA = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
    const meshB = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint);
    const rootA = new THREE.Group();
    const rootB = new THREE.Group();
    rootA.add(meshA);
    rootB.add(meshB);
    applyLivery(rootA, ['livery'], livery({ primary: '#ff0000' }), BOUNDS);
    applyLivery(rootB, ['livery'], livery({ primary: '#0000ff' }), BOUNDS);
    expect(meshA.material).not.toBe(meshB.material);
    expect(colorU(meshA.material as THREE.Material, 'uPrimary')).toBe('ff0000');
    expect(colorU(meshB.material as THREE.Material, 'uPrimary')).toBe('0000ff');
  });

  it('POST8: re-applying with different bounds updates the bounds uniforms on the same clone', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery(), BOUNDS);
    const mat = car.paintMesh.material;
    expect(vecU(mat, 'uBoundsMin').toArray()).toEqual([-1, 0, -2.5]);
    applyLivery(car.root, ['livery'], livery(), MOVED);
    expect(car.paintMesh.material).toBe(mat);
    expect(vecU(mat, 'uBoundsMin').toArray()).toEqual([0, 0, 0]);
    expect(vecU(mat, 'uBoundsSize').toArray()).toEqual([2, 3, 4]);
  });

  it('POST9: zero-size bounds axes report size 0 so the shader falls back to coordinate 0', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery(), POINT);
    expect(vecU(car.paintMesh.material, 'uBoundsSize').toArray()).toEqual([0, 0, 0]);
    expect(vecU(car.paintMesh.material, 'uBoundsMin').toArray()).toEqual([1, 1, 1]);
    applyLivery(car.root, ['livery'], livery(), FLAT);
    expect(vecU(car.paintMesh.material, 'uBoundsSize').toArray()).toEqual([2, 0, 4]);
  });

  it('POST10: an unknown pattern falls back to solid in both JS and the uniform', () => {
    const weird = { ...livery(), pattern: 'plaid' } as unknown as Livery;
    expect(liveryColorAt('plaid' as LiveryPattern, 0.5, 0.1, 0.5)).toBe(0);
    expect(liveryColorAt('plaid' as LiveryPattern, 0.5, 0.1, 0.9)).toBe(0);
    expect(liveryColorAt('plaid' as LiveryPattern, 0.5, 0.5, 0.5)).toBe(0);
    const car = buildCar();
    applyLivery(car.root, ['livery'], weird, BOUNDS);
    expect(patternU(car.paintMesh.material)).toBe(0);
  });

  it('POST11: the patched shaders carry the GLSL mirror of liveryColorAt', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery(), BOUNDS);
    const mat = car.paintMesh.material as THREE.MeshStandardMaterial;
    const shader = {
      uniforms: {},
      vertexShader: 'V\n#include <common>\n#include <begin_vertex>\n',
      fragmentShader: 'F\n#include <common>\n#include <map_fragment>\n',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const vs = shader.vertexShader;
    const fs = shader.fragmentShader;
    expect(vs).toContain('vLiveryPos = transformed');
    expect(fs).toContain('uniform int uPattern');
    expect(fs).toContain('uniform vec3 uBoundsMin');
    expect(fs).toContain('uniform vec3 uBoundsSize');
    expect(fs).toContain('liveryColour(');
    expect(fs).toContain('liveryD < 0.08');
    expect(fs).toContain('liveryD < 0.1');
    expect(fs).toContain('h > 0.55');
    expect(fs).toContain('v < 0.35');
    expect(fs).toContain('0.35 - v');
    expect(fs).toContain('uBoundsSize.x > 0.0');
    expect(fs).toContain('uBoundsSize.y > 0.0');
    expect(fs).toContain('uBoundsSize.z > 0.0');
    expect(fs).toContain('0.2126');
    expect(fs.indexOf('#include <map_fragment>')).toBeLessThan(fs.indexOf('diffuseColor.rgb = liveryColour'));
    const real = fakeShader();
    mat.onBeforeCompile(real, {} as THREE.WebGLRenderer);
    expect(real.vertexShader).toContain('vLiveryPos');
    expect(real.fragmentShader).toContain('liveryColour(');
  });

  it('POST12: the livery program cache key differs from an unpainted standard material', () => {
    const car = buildCar();
    applyLivery(car.root, ['livery'], livery(), BOUNDS);
    const key = (car.paintMesh.material as THREE.MeshStandardMaterial).customProgramCacheKey();
    const plain = new THREE.MeshStandardMaterial().customProgramCacheKey();
    expect(typeof key).toBe('string');
    expect(key).not.toBe(plain);
    expect((car.paintMesh.material as THREE.MeshStandardMaterial).customProgramCacheKey()).toBe(key);
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { LIVERY_PATTERNS, type Livery } from '../../../src/game/livery';
import { applyLivery, liveryColorAt } from '../../../src/render/liveryMaterial';

const MODELS = join(__dirname, '..', '..', '..', 'public', 'models');

const BOUNDS = new THREE.Box3(new THREE.Vector3(-1, 0, -2.5), new THREE.Vector3(1, 1.5, 2.5));

function fakeShader(): THREE.WebGLProgramParametersWithUniforms {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

interface Car {
  root: THREE.Group;
  paint: THREE.MeshStandardMaterial;
  other: THREE.MeshStandardMaterial;
  paintMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  otherMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
}

function buildCar(): Car {
  const paint = new THREE.MeshStandardMaterial({ name: 'livery' });
  const other = new THREE.MeshStandardMaterial({ name: 'glass' });
  const paintMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 5), paint);
  const otherMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), other);
  const root = new THREE.Group();
  root.add(paintMesh, otherMesh);
  return { root, paint, other, paintMesh, otherMesh };
}

describe('120 livery shader acceptance', () => {
  it('AT1: every model json lists non-empty paintMaterials present in its glb', async () => {
    const files = readdirSync(MODELS)
      .filter((f) => f.endsWith('.json'))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const id = file.slice(0, -'.json'.length);
      const json = JSON.parse(readFileSync(join(MODELS, file), 'utf8')) as { paintMaterials?: unknown };
      expect(json.paintMaterials, `${id} paintMaterials`).toBeInstanceOf(Array);
      const paint = json.paintMaterials as string[];
      expect(paint.length, `${id} paintMaterials non-empty`).toBeGreaterThan(0);
      const doc = await new NodeIO().read(join(MODELS, `${id}.glb`));
      const materialNames = doc.getRoot().listMaterials().map((m) => m.getName());
      for (const name of paint) {
        expect(materialNames, `${id} material ${name}`).toContain(name);
      }
    }
  });

  it('AT2: liveryColorAt returns 1, 2, 0, 1, 1, 0 for the six pattern samples', () => {
    expect(liveryColorAt('stripe', 0.5, 0.5, 0.5)).toBe(1);
    expect(liveryColorAt('stripe', 0.59, 0.5, 0.5)).toBe(2);
    expect(liveryColorAt('stripe', 0.8, 0.5, 0.5)).toBe(0);
    expect(liveryColorAt('split', 0.5, 0.5, 0.6)).toBe(1);
    expect(liveryColorAt('chevron', 0.5, 0.1, 0.5)).toBe(1);
    expect(liveryColorAt('chevron', 0.9, 0.1, 0.5)).toBe(0);
  });

  it('AT3: applyLivery gives the paint material the livery uniforms, leaves B untouched and both cars share one program cache key', () => {
    const carA = buildCar();
    const carB = buildCar();
    const liveryA: Livery = { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', pattern: 'stripe', number: 7 };
    const liveryB: Livery = { primary: '#0000ff', secondary: '#ffff00', accent: '#ff00ff', pattern: 'chevron', number: 3 };
    applyLivery(carA.root, ['livery'], liveryA, BOUNDS);
    applyLivery(carB.root, ['livery'], liveryB, BOUNDS);

    const matA = carA.paintMesh.material;
    expect(matA).not.toBe(carA.paint);
    const shaderA = fakeShader();
    matA.onBeforeCompile(shaderA, {} as THREE.WebGLRenderer);
    for (const key of ['uPrimary', 'uSecondary', 'uAccent', 'uPattern', 'uBoundsMin', 'uBoundsSize']) {
      expect(shaderA.uniforms, key).toHaveProperty(key);
    }
    expect(shaderA.uniforms.uPattern.value).toBe(LIVERY_PATTERNS.indexOf(liveryA.pattern));

    expect(carA.otherMesh.material).toBe(carA.other);
    const shaderOther = fakeShader();
    carA.other.onBeforeCompile(shaderOther, {} as THREE.WebGLRenderer);
    expect(Object.keys(shaderOther.uniforms)).toEqual([]);

    const matB = carB.paintMesh.material;
    expect(matB).not.toBe(carB.paint);
    expect(typeof matA.customProgramCacheKey()).toBe('string');
    expect(matA.customProgramCacheKey()).toBe(matB.customProgramCacheKey());
  });
});

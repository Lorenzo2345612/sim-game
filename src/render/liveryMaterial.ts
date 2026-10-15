import * as THREE from 'three';
import { LIVERY_PATTERNS } from '../game/livery';
import type { Livery, LiveryPattern } from '../game/livery';

/** 0 primary, 1 secondary, 2 accent — the GLSL below mirrors this exactly. */
export function liveryColorAt(pattern: LiveryPattern, u: number, v: number, h: number): 0 | 1 | 2 {
  switch (pattern) {
    case 'stripe': {
      const d = Math.abs(u - 0.5);
      return d < 0.08 ? 1 : d < 0.1 ? 2 : 0;
    }
    case 'split':
      return h > 0.55 ? 1 : 0;
    case 'chevron':
      return v < 0.35 && Math.abs(u - 0.5) < 0.35 - v ? 1 : 0;
    default:
      return 0;
  }
}

interface LiveryUniforms {
  uPrimary: { value: THREE.Color };
  uSecondary: { value: THREE.Color };
  uAccent: { value: THREE.Color };
  uPattern: { value: number };
  uBoundsMin: { value: THREE.Vector3 };
  uBoundsSize: { value: THREE.Vector3 };
}

// WeakMap so a makeGhost()/user clone (JSON-copied userData) never inherits a stale state.
const liveryStates = new WeakMap<THREE.MeshStandardMaterial, LiveryUniforms>();

const PROGRAM_KEY = 'livery-paint';

const VERTEX_PARS = /* glsl */ `
varying vec3 vLiveryPos;`;

const VERTEX_POS = /* glsl */ `
	vLiveryPos = transformed;`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vLiveryPos;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform int uPattern;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsSize;
vec3 liveryColour( vec3 p ) {
	float u = uBoundsSize.x > 0.0 ? ( p.x - uBoundsMin.x ) / uBoundsSize.x : 0.0;
	float v = uBoundsSize.z > 0.0 ? ( p.z - uBoundsMin.z ) / uBoundsSize.z : 0.0;
	float h = uBoundsSize.y > 0.0 ? ( p.y - uBoundsMin.y ) / uBoundsSize.y : 0.0;
	float liveryD = abs( u - 0.5 );
	int c = 0;
	if ( uPattern == 1 ) {
		c = liveryD < 0.08 ? 1 : ( liveryD < 0.1 ? 2 : 0 );
	} else if ( uPattern == 2 ) {
		c = h > 0.55 ? 1 : 0;
	} else if ( uPattern == 3 ) {
		c = v < 0.35 && liveryD < 0.35 - v ? 1 : 0;
	}
	return c == 1 ? uSecondary : ( c == 2 ? uAccent : uPrimary );
}`;

// Chosen colour over the base luminance keeps the map's shading as detail.
const FRAGMENT_PAINT = /* glsl */ `
	float liveryLum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	diffuseColor.rgb = liveryColour( vLiveryPos ) * liveryLum;`;

function setUniforms(uniforms: LiveryUniforms, livery: Livery, bounds: THREE.Box3): void {
  uniforms.uPrimary.value.set(livery.primary);
  uniforms.uSecondary.value.set(livery.secondary);
  uniforms.uAccent.value.set(livery.accent);
  uniforms.uPattern.value = Math.max(0, LIVERY_PATTERNS.indexOf(livery.pattern));
  uniforms.uBoundsMin.value.set(bounds.min.x, bounds.min.y, bounds.min.z);
  uniforms.uBoundsSize.value.set(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
}

function patch(
  mat: THREE.MeshStandardMaterial,
  livery: Livery,
  bounds: THREE.Box3,
): THREE.MeshStandardMaterial {
  const clone = mat.clone();
  const uniforms: LiveryUniforms = {
    uPrimary: { value: new THREE.Color() },
    uSecondary: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uPattern: { value: 0 },
    uBoundsMin: { value: new THREE.Vector3() },
    uBoundsSize: { value: new THREE.Vector3() },
  };
  setUniforms(uniforms, livery, bounds);
  liveryStates.set(clone, uniforms);
  // glTF paint materials default to metalness 1, which would suppress the diffuse term.
  clone.metalness = 0;
  clone.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${VERTEX_POS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>${FRAGMENT_PAINT}`);
  };
  clone.customProgramCacheKey = () => PROGRAM_KEY;
  return clone;
}

/** Lower-case #rrggbb of the applied uPrimary uniform, or null when nothing here is painted. */
export function liveryPrimaryOf(root: THREE.Object3D): string | null {
  let out: string | null = null;
  root.traverse((obj) => {
    if (out !== null) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const state = m instanceof THREE.MeshStandardMaterial ? liveryStates.get(m) : undefined;
      if (!state) continue;
      out = `#${state.uPrimary.value.getHexString()}`;
      return;
    }
  });
  return out;
}

export function applyLivery(
  root: THREE.Object3D,
  paintMaterials: string[],
  livery: Livery,
  bounds: THREE.Box3,
): void {
  const clones = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let replaced = false;
    const next = materials.map((m) => {
      if (!(m instanceof THREE.MeshStandardMaterial) || !paintMaterials.includes(m.name)) return m;
      const state = liveryStates.get(m);
      if (state) {
        setUniforms(state, livery, bounds);
        return m;
      }
      let clone = clones.get(m);
      if (!clone) {
        clone = patch(m, livery, bounds);
        clones.set(m, clone);
      }
      replaced = true;
      return clone;
    });
    if (replaced) mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

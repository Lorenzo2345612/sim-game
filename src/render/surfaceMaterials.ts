import * as THREE from 'three';

export type SurfaceMaterialKind = 'asphalt' | 'runoff' | 'gravel' | 'grass' | 'kerb' | 'concrete';

export interface SurfaceMaterialUserData {
  tileMeters: number;
  saturation: number;
  tint: number;
  textures: THREE.Texture[];
}

interface KindConfig {
  dir: string;
  tileMeters: number;
  saturation: number;
  tint: number;
  kerb: boolean;
}

const KINDS: Record<SurfaceMaterialKind, KindConfig> = {
  asphalt: { dir: 'asphalt-track', tileMeters: 8, saturation: 0.8, tint: 1, kerb: false },
  runoff: { dir: 'asphalt', tileMeters: 8, saturation: 0.8, tint: 1.15, kerb: false },
  gravel: { dir: 'gravel', tileMeters: 3, saturation: 0.55, tint: 0.85, kerb: false },
  grass: { dir: 'grass-mown', tileMeters: 5, saturation: 0.9, tint: 1, kerb: false },
  kerb: { dir: 'kerb', tileMeters: 1.5, saturation: 1, tint: 1, kerb: true },
  concrete: { dir: 'concrete', tileMeters: 4, saturation: 1, tint: 1, kerb: false },
};

const MACRO_URL = 'textures/macro-noise.png';

function defaultLoadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.name = url;
  return texture;
}

// mat2 column-major: rotation by 37 degrees (cos 0.79864, sin 0.60182).
const ANTI_TILING_MAP = /* glsl */ `
#ifdef USE_MAP
	vec4 surfaceTileA = texture2D( map, vMapUv );
	vec2 surfaceUvB = mat2( 0.79864, 0.60182, - 0.60182, 0.79864 ) * ( vMapUv * 0.29 );
	vec4 surfaceTileB = texture2D( map, surfaceUvB );
	vec4 sampledDiffuseColor = mix( surfaceTileA, surfaceTileB, texture2D( uMacro, vSurfaceWorldXz / 180.0 ).r );
	sampledDiffuseColor.rgb *= 1.0 + ( texture2D( uMacro, vSurfaceWorldXz / 40.0 ).g - 0.5 ) * 0.24;
	float surfaceLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	sampledDiffuseColor.rgb = mix( vec3( surfaceLum ), sampledDiffuseColor.rgb, uSaturation );
	sampledDiffuseColor.rgb *= uTint;
	diffuseColor *= sampledDiffuseColor;
#endif
`;

/** Two-scale albedo blend (macro R at 180 m) plus brightness variation (macro G at 40 m), saturation and tint. */
export function applyAntiTiling(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: Record<string, THREE.IUniform>,
): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vSurfaceWorldXz;')
    .replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tvSurfaceWorldXz = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec2 vSurfaceWorldXz;\nuniform sampler2D uMacro;\nuniform float uSaturation;\nuniform float uTint;',
    )
    .replace('#include <map_fragment>', ANTI_TILING_MAP);
}

/** Kerb stripes: one colour per uv.v unit (1.5 m of arc), modulated by the albedo luminance. */
function applyKerbStripes(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uStripeA;\nuniform vec3 uStripeB;',
    )
    .replace(
      'diffuseColor *= sampledDiffuseColor;',
      `float stripeLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float stripeMask = mod( floor( vMapUv.y ), 2.0 );
	sampledDiffuseColor.rgb = mix( uStripeA, uStripeB, stripeMask ) * stripeLum;
	diffuseColor *= sampledDiffuseColor;`,
    );
}

export function createSurfaceMaterial(
  kind: SurfaceMaterialKind,
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
  macro?: THREE.Texture,
): THREE.MeshStandardMaterial {
  const config = KINDS[kind];
  const material = new THREE.MeshStandardMaterial();
  const map = loadTexture(`textures/${config.dir}/color.jpg`);
  const normalMap = loadTexture(`textures/${config.dir}/normal.jpg`);
  const roughnessMap = loadTexture(`textures/${config.dir}/roughness.jpg`);
  const macroTexture = macro ?? loadTexture(MACRO_URL);
  const owned = [map, normalMap, roughnessMap, macroTexture];
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of owned) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  // Strip uv is metres / 10, so repeat 10 / tileMeters gives one tile per tileMeters;
  // kerb v is already s / 1.5 and u spans the kerb width, so the map repeats (1, 1).
  const repeat = kind === 'kerb' ? 1 : 10 / config.tileMeters;
  map.repeat.set(repeat, repeat);
  normalMap.repeat.set(repeat, repeat);
  roughnessMap.repeat.set(repeat, repeat);
  material.map = map;
  material.normalMap = normalMap;
  material.roughnessMap = roughnessMap;

  const uniforms: Record<string, THREE.IUniform> = {
    uMacro: { value: macroTexture },
    uSaturation: { value: config.saturation },
    uTint: { value: config.tint },
  };
  if (config.kerb) {
    uniforms.uStripeA = { value: new THREE.Vector3(0.78, 0.1, 0.1) };
    uniforms.uStripeB = { value: new THREE.Vector3(0.92, 0.92, 0.92) };
  }
  material.onBeforeCompile = (shader) => {
    applyAntiTiling(shader, uniforms);
    if (config.kerb) applyKerbStripes(shader);
  };
  material.customProgramCacheKey = () => `surface-${kind}`;
  material.userData = {
    tileMeters: config.tileMeters,
    saturation: config.saturation,
    tint: config.tint,
    textures: owned,
  } satisfies SurfaceMaterialUserData;
  return material;
}

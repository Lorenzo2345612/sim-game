import * as THREE from 'three';
import type { ResolvedTrackStyle } from '../track/trackStyle';
import { registerWhitePaint } from './sceneSetup';

export type SurfaceMaterialKind = 'asphalt' | 'runoff' | 'gravel' | 'grass' | 'kerb' | 'concrete';

export interface SurfaceMaterialUserData {
  tileMeters: number;
  saturation: number;
  tint: number;
  textures: THREE.Texture[];
  stripeColors?: [string, string] | null;
  pattern?: 'solid' | 'stripes' | 'bands';
  colors?: string[];
  stripeMeters?: number;
}

export interface SurfacePaint {
  stripeColors?: [string, string];
  pattern?: 'solid' | 'stripes' | 'bands';
  colors?: string[];
  stripeMeters?: number;
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

/** Run-off paint: paint colour modulated by the albedo luminance; block index from uv (metres / stripeMeters). */
function applyRunoffPaint(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uPaintColors[4];\nuniform int uPaintCount;\nuniform float uPaintStripe;\nuniform int uPaintMode;',
    )
    .replace(
      'diffuseColor *= sampledDiffuseColor;',
      `float paintLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float paintShade = clamp( paintLum / 0.3, 0.6, 1.2 );
	float paintBlock = 0.0;
	if ( uPaintMode == 1 ) paintBlock = floor( vMapUv.y * 8.0 / uPaintStripe );
	else if ( uPaintMode == 2 ) paintBlock = floor( abs( vMapUv.x ) * 8.0 / uPaintStripe );
	int paintIndex = int( mod( paintBlock, float( max( uPaintCount, 1 ) ) ) );
	vec3 paintCol = uPaintColors[0];
	if ( paintIndex > 0 ) paintCol = uPaintColors[1];
	if ( paintIndex > 1 ) paintCol = uPaintColors[2];
	if ( paintIndex > 2 ) paintCol = uPaintColors[3];
	if ( uPaintMode == 0 || uPaintCount != 1 || mod( paintBlock, 2.0 ) < 0.5 ) {
		sampledDiffuseColor.rgb = paintCol * paintShade;
	}
	diffuseColor *= sampledDiffuseColor;`,
    );
}

const PAINT_MODE: Record<'solid' | 'stripes' | 'bands', number> = { solid: 0, stripes: 1, bands: 2 };

export function createSurfaceMaterial(
  kind: SurfaceMaterialKind,
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
  macro?: THREE.Texture,
  style?: ResolvedTrackStyle /* accepted, unused until 184 */,
  paint?: SurfacePaint,
): THREE.MeshStandardMaterial {
  void style;
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

  const activePaint =
    kind === 'runoff' && paint?.pattern
      ? { pattern: paint.pattern, colors: paint.colors ?? [], stripeMeters: paint.stripeMeters ?? 2 }
      : undefined;

  const uniforms: Record<string, THREE.IUniform> = {
    uMacro: { value: macroTexture },
    uSaturation: { value: config.saturation },
    uTint: { value: config.tint },
  };
  if (config.kerb) {
    const stripeWhite = new THREE.Color(0.7, 0.7, 0.7);
    const stripeA = paint?.stripeColors ? new THREE.Color(paint.stripeColors[0]) : new THREE.Color(0.78, 0.1, 0.1);
    const stripeB = paint?.stripeColors ? new THREE.Color(paint.stripeColors[1]) : stripeWhite;
    uniforms.uStripeA = { value: new THREE.Vector3(stripeA.r, stripeA.g, stripeA.b) };
    uniforms.uStripeB = { value: new THREE.Vector3(stripeB.r, stripeB.g, stripeB.b) };
    registerWhitePaint({ color: stripeWhite });
  }
  if (activePaint) {
    const cols = activePaint.colors;
    const paintColors = Array.from(
      { length: 4 },
      (_, i) => {
        const hex = i < cols.length ? cols[i] : cols[cols.length - 1];
        const c = hex === undefined ? new THREE.Color(0, 0, 0) : new THREE.Color(hex);
        return new THREE.Vector3(c.r, c.g, c.b);
      },
    );
    uniforms.uPaintColors = { value: paintColors };
    uniforms.uPaintCount = { value: Math.min(cols.length, 4) };
    uniforms.uPaintStripe = { value: activePaint.stripeMeters };
    uniforms.uPaintMode = { value: PAINT_MODE[activePaint.pattern] };
  }
  material.onBeforeCompile = (shader) => {
    applyAntiTiling(shader, uniforms);
    if (config.kerb) applyKerbStripes(shader);
    if (activePaint) applyRunoffPaint(shader);
  };
  material.customProgramCacheKey = () => `surface-${kind}${activePaint ? `-paint-${activePaint.pattern}` : ''}`;
  material.userData = {
    tileMeters: config.tileMeters,
    saturation: config.saturation,
    tint: config.tint,
    textures: owned,
    ...(config.kerb ? { stripeColors: paint?.stripeColors ?? null } : {}),
    ...(activePaint
      ? { pattern: activePaint.pattern, colors: activePaint.colors, stripeMeters: activePaint.stripeMeters }
      : {}),
  } satisfies SurfaceMaterialUserData;
  return material;
}

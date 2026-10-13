import * as THREE from 'three';
import type { Terrain } from '../core/types';
import { applyAntiTiling } from './surfaceMaterials';

const MACRO_URL = 'textures/macro-noise.png';
const SET_DIRS = ['grass-mown', 'grass', 'grass-dark', 'dirt'] as const;

function defaultLoadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.name = url;
  return texture;
}

/** Per-vertex min(cap, horizontal distance to the nearest centerline point), in createTerrainMesh vertex order (i = row/z, j = col/x). */
export function terrainTrackDistance(
  terrain: Terrain,
  centerline: [number, number][],
  cap = 200,
): Float32Array {
  const vertexRows = terrain.rows + 1;
  const vertexCols = terrain.cols + 1;
  const out = new Float32Array(vertexRows * vertexCols);
  if (centerline.length === 0) {
    out.fill(cap);
    return out;
  }
  // Uniform grid with cell = cap: any point closer than cap to a vertex lies in the 3x3
  // neighbourhood of its cell, so points outside it can never beat the cap.
  const cells = new Map<string, number[]>();
  for (let p = 0; p < centerline.length; p++) {
    const key = `${Math.floor(centerline[p][0] / cap)},${Math.floor(centerline[p][1] / cap)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(p);
    else cells.set(key, [p]);
  }
  const minX = terrain.originX - terrain.sizeX / 2;
  const minZ = terrain.originZ - terrain.sizeZ / 2;
  for (let i = 0; i <= terrain.rows; i++) {
    const z = minZ + (i * terrain.sizeZ) / terrain.rows;
    const cellZ = Math.floor(z / cap);
    for (let j = 0; j <= terrain.cols; j++) {
      const x = minX + (j * terrain.sizeX) / terrain.cols;
      const cellX = Math.floor(x / cap);
      let bestD2 = cap * cap;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = cells.get(`${cellX + dx},${cellZ + dz}`);
          if (!bucket) continue;
          for (const p of bucket) {
            const ddx = centerline[p][0] - x;
            const ddz = centerline[p][1] - z;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 < bestD2) bestD2 = d2;
          }
        }
      }
      out[i * vertexCols + j] = Math.min(cap, Math.sqrt(bestD2));
    }
  }
  return out;
}

const VERTEX_PARS = /* glsl */ `
attribute float trackDist;
varying float vTrackDist;
varying float vTerrainSlope;`;

// Slope = acos of the world-space normal y; the mesh is untransformed but go through
// modelMatrix so a transform would not silently break the dirt mask.
const VERTEX_SLOPE = /* glsl */ `
	vec3 terrainWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
	vTerrainSlope = acos( clamp( terrainWorldNormal.y, -1.0, 1.0 ) );`;

const FRAGMENT_PARS = /* glsl */ `
varying float vTrackDist;
varying float vTerrainSlope;
uniform sampler2D uGrassB;
uniform sampler2D uGrassC;
uniform sampler2D uDirt;
uniform sampler2D uDirtNormal;
uniform sampler2D uDirtRoughness;
vec3 terrainAntiTiled( sampler2D tex, vec2 uvA, vec2 uvB, float macroR, float macroG, float saturation, float tint ) {
	vec3 c = mix( texture2D( tex, uvA ).rgb, texture2D( tex, uvB ).rgb, macroR );
	c *= 1.0 + ( macroG - 0.5 ) * 0.24;
	float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	return mix( vec3( lum ), c, saturation ) * tint;
}`;

// Replaces the tail of applyAntiTiling's map chunk: sampledDiffuseColor is the
// anti-tiled grass-A set, B/C/dirt get the same treatment, then splat and stripe.
const TERRAIN_ALBEDO = /* glsl */ `
float trackDist = vTrackDist;
float terrainDirtW = smoothstep( 0.35, 0.45, vTerrainSlope );
float terrainMacroR = texture2D( uMacro, vSurfaceWorldXz / 180.0 ).r;
float terrainMacroG = texture2D( uMacro, vSurfaceWorldXz / 40.0 ).g;
vec2 terrainUvB = mat2( 0.79864, 0.60182, -0.60182, 0.79864 ) * ( vMapUv * 0.29 );
vec3 terrainB = terrainAntiTiled( uGrassB, vMapUv, terrainUvB, terrainMacroR, terrainMacroG, uSaturation, uTint );
vec3 terrainC = terrainAntiTiled( uGrassC, vMapUv, terrainUvB, terrainMacroR, terrainMacroG, uSaturation, uTint );
float terrainBlend = texture2D( uMacro, vSurfaceWorldXz / 220.0 ).r;
vec3 terrainGrass = mix( mix( sampledDiffuseColor.rgb, terrainB, smoothstep( 0.0, 0.5, terrainBlend ) ), terrainC, smoothstep( 0.5, 1.0, terrainBlend ) );
if ( trackDist < 60.0 ) {
	terrainGrass *= mod( floor( vSurfaceWorldXz.x / 12.0 ), 2.0 ) < 0.5 ? 1.06 : 0.94;
}
vec3 terrainAlbedo = terrainGrass;
if ( terrainDirtW > 0.0 ) {
	vec3 terrainDirt = terrainAntiTiled( uDirt, vMapUv, terrainUvB, terrainMacroR, terrainMacroG, uSaturation, uTint );
	terrainAlbedo = mix( terrainGrass, terrainDirt, terrainDirtW );
}
sampledDiffuseColor.rgb = terrainAlbedo;
diffuseColor *= sampledDiffuseColor;`;

// normal_fragment_maps with the tangent-space branch blending the dirt normal by the
// same weight (other branches unchanged from three 0.186).
const TERRAIN_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP_OBJECTSPACE

	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;

	#ifdef FLIP_SIDED

		normal = - normal;

	#endif

	#ifdef DOUBLE_SIDED

		normal = normal * faceDirection;

	#endif

	normal = normalize( normalMatrix * normal );

#elif defined( USE_NORMALMAP_TANGENTSPACE )

	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;

	#if defined( USE_PACKED_NORMALMAP )

		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );

	#endif

	mapN.xy *= normalScale;

	if ( terrainDirtW > 0.0 ) {
		vec3 terrainDirtN = texture2D( uDirtNormal, vNormalMapUv ).xyz * 2.0 - 1.0;
		terrainDirtN.xy *= normalScale;
		mapN = mix( mapN, terrainDirtN, terrainDirtW );
	}

	normal = normalize( tbn * mapN );

#elif defined( USE_BUMPMAP )

	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );

#endif
`;

const TERRAIN_ROUGHNESS = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP

	float terrainRoughA = texture2D( roughnessMap, vRoughnessMapUv ).g;
	float terrainRoughDirt = terrainRoughA;
	if ( terrainDirtW > 0.0 ) {
		terrainRoughDirt = texture2D( uDirtRoughness, vRoughnessMapUv ).g;
	}
	roughnessFactor *= mix( terrainRoughA, terrainRoughDirt, terrainDirtW );

#endif
`;

export function createTerrainMaterial(
  loadTexture: (url: string) => THREE.Texture = defaultLoadTexture,
): THREE.MeshStandardMaterial {
  const sets = SET_DIRS.map((dir) => ({
    color: loadTexture(`textures/${dir}/color.jpg`),
    normal: loadTexture(`textures/${dir}/normal.jpg`),
    roughness: loadTexture(`textures/${dir}/roughness.jpg`),
  }));
  const [grassA, grassB, grassC, dirt] = sets;
  const macro = loadTexture(MACRO_URL);
  const owned = [...sets.flatMap((set) => [set.color, set.normal, set.roughness]), macro];
  for (const set of sets) set.color.colorSpace = THREE.SRGBColorSpace;
  for (const texture of owned) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  // Terrain uv is metres / 10, so repeat 2 tiles every 5 m.
  for (const set of sets) {
    for (const texture of [set.color, set.normal, set.roughness]) texture.repeat.set(2, 2);
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 1 });
  material.map = grassA.color;
  material.normalMap = grassA.normal;
  material.roughnessMap = grassA.roughness;

  // ~0.6 linear keeps sunlit grass below the 0.5 screen luminance the 043 AT2 tree band expects.
  const uniforms: Record<string, THREE.IUniform> = {
    uGrassA: { value: grassA.color },
    uGrassB: { value: grassB.color },
    uGrassC: { value: grassC.color },
    uDirt: { value: dirt.color },
    uDirtNormal: { value: dirt.normal },
    uDirtRoughness: { value: dirt.roughness },
    uMacro: { value: macro },
    uSaturation: { value: 0.9 },
    uTint: { value: 0.6 },
  };
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERTEX_SLOPE}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n\tvTrackDist = trackDist;');
    applyAntiTiling(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('diffuseColor *= sampledDiffuseColor;', TERRAIN_ALBEDO)
      .replace('#include <roughnessmap_fragment>', TERRAIN_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL);
  };
  material.customProgramCacheKey = () => 'terrain-splat';
  material.userData = { textures: owned };
  return material;
}

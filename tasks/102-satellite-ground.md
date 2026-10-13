# 102 — Satellite colour on distant terrain

Status: pending
Phase: 1
Depends on: 081
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Terrain far from the track (300–600 m) fades from procedural grass to a Sentinel-2 true-colour image of the real site.

## Context

Plan: `docs/plans/m1.2c-realism.md`. Image `public/textures/ground/<track>.jpg` (2048², installed by the planner) covers exactly the terrain bounds. Image top = terrain min Z (north), left = min X. Extends `createTerrainMaterial` and the `trackDist` attribute from `tasks/081-terrain-material.md`. 081's default `terrainTrackDistance` cap is 200, which would hide the effect: `main.ts` must now pass cap 600.

## Files

- `src/render/terrainMaterial.ts` — modify — `groundUv`, `satelliteWeight`, optional ground overlay.
- `src/main.ts` — modify — pass overlay + cap 600; `groundTexture` stat.
- `tests/unit/acceptance/102-satellite-ground.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Terrain } from '../core/types';
export type GroundRect = Pick<Terrain, 'originX' | 'originZ' | 'sizeX' | 'sizeZ'>;
export function groundUv(rect: GroundRect, x: number, z: number): [number, number];
export function satelliteWeight(trackDist: number): number;
export interface GroundOverlay { url: string; rect: GroundRect }
export function createTerrainMaterial(loadTexture?: (url: string) => THREE.Texture, ground?: GroundOverlay): THREE.MeshStandardMaterial; // extends 081
// main.ts: SceneStats gains groundTexture: string | null  (the overlay url, null if none)
```

1. `groundUv`: `u = (x - (originX - sizeX/2)) / sizeX`, `v = (z - (originZ - sizeZ/2)) / sizeZ`. Not clamped.
2. `satelliteWeight`: `smoothstep(300, 600, trackDist)` (standard GLSL smoothstep; 0 below 300, 1 above 600).
3. With `ground` given, load `ground.url` via `loadTexture`; set `colorSpace = SRGBColorSpace`, `wrapS = wrapT = ClampToEdgeWrapping`, `flipY = false`, anisotropy unchanged. Add uniforms `uGround` (texture) and `uGroundRect` (`Vector4(minX, minZ, sizeX, sizeZ)`) to the 081 shader. In the fragment shader (same formulas as the TS functions, uv clamped to [0,1]): albedo = `mix(081 grass/dirt albedo, texture(uGround, uv).rgb, satelliteWeight(trackDist))`. Normal and roughness stay procedural. Without `ground`, the material is identical to 081 (no uniforms added).
4. `main.ts`: URL `textures/ground/${track.id}.jpg`, rect from `track.terrain`; call `terrainTrackDistance(track.terrain, track.centerline, 600)`; `stats.groundTexture` = that URL.

Conventions: `groundUv` and `satelliteWeight` are pure, no clamping/rounding in the TS functions, NaN in → NaN out; boundaries 300 and 600 inclusive map to 0 and 1.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/102-satellite-ground.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: ground UV for a world point at the terrain's min/max corners | call | (0,0) / (1,1) ± 1e-6 (u along +X, v along +Z) |
| AT2 | unit: satellite weight at track distance 100 / 300 / 600 m | call | 0 / 0 / 1 with smoothstep between 300 and 600 m |
| AT3 | e2e monza | ready | terrain material has a `uGround` texture loaded from `textures/ground/monza.jpg`; no console errors |

## Acceptance criteria

- [ ] All AT rows pass (AT3 observable via `sceneStats().groundTexture` ending in `textures/ground/monza.jpg`).
- [ ] 081 tests still pass; `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Fetching/cropping the satellite image, tinting/colour-matching it to the grass, satellite on track surfaces, changing the 081 stripes/dirt logic, terrain mesh changes.

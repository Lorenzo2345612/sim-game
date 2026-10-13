# 081 — Terrain splat material with track-distance mown stripes

Status: pending
Phase: 1
Depends on: 080
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The terrain blends three grass variants and dirt on steep slopes, shows mown stripes near the track, and does not visibly tile.

## Context

Replaces `createTerrainMaterial` in `src/main.ts`. Terrain type is in `ai/guides/architecture.md` (`Terrain`, heights in Rapier layout `heights[j * (rows+1) + i]`, origin = centre; see `createTerrainMesh` for vertex positions). Uses `applyAntiTiling` from `src/render/surfaceMaterials.ts` (task 080). Texture dirs in `public/textures/` (see 080).

## Files

- `src/render/terrainMaterial.ts` — create — pure `terrainTrackDistance` and `createTerrainMaterial`.
- `src/render/terrainRenderer.ts` — modify — optional `trackDist` attribute.
- `src/main.ts` — modify — remove local `createTerrainMaterial`/`loadTiledTexture` (if unused), compute and pass `trackDist`.
- `tests/unit/acceptance/081-terrain-material.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Terrain } from '../core/types';
export function terrainTrackDistance(terrain: Terrain, centerline: [number, number][], cap?: number): Float32Array; // cap default 200
export function createTerrainMaterial(loadTexture?: (url: string) => THREE.Texture): THREE.MeshStandardMaterial;
// terrainRenderer.ts
export function createTerrainMesh(terrain: Terrain, material?: THREE.Material, trackDist?: Float32Array): THREE.Mesh;
```

(Centerline points are (x, z); `Point2` does not exist in types.ts, use the tuple type.)

1. `terrainTrackDistance`: one value per mesh vertex in the same order as `createTerrainMesh` positions (index `i * (cols+1) + j`, i = row/z, j = col/x). Value = min(cap, horizontal (x,z) distance to the nearest centerline point). Use a uniform cell grid (cell size = cap) so cost is not O(N·M). Empty centerline → all `cap`.
2. `createTerrainMesh`: if `trackDist` given, add attribute `'trackDist'` (itemSize 1) with the same values; if its length ≠ vertex count, throw `Error('createTerrainMesh: invalid trackDist')`.
3. `createTerrainMaterial`: loads colour/normal/roughness for `grass-mown` (uGrassA), `grass` (uGrassB), `grass-dark` (uGrassC), `dirt` (uDirt) plus `textures/macro-noise.png` (uMacro); RepeatWrapping; colour SRGB. Tile 5 m per texture (repeat 2 on uv = metres/10). Uniforms named exactly as listed.
4. Shader (`onBeforeCompile`, vertex shader passes `trackDist`, world position and normal slope to fragment): grass colour = blend of A/B/C by macro R at world-xz/220 m; mown stripes: brightness ±6 % in 12 m bands along world X only where `trackDist < 60`; dirt weight = smoothstep over slope 0.45 rad (full dirt above) with 0.1 rad transition (slope = acos of world normal y); every albedo sample uses `applyAntiTiling` from 080. Normal and roughness come from the grass-A set blended with dirt by the same weight.
5. `main.ts`: compute `terrainTrackDistance(track.terrain, track.centerline)` once per track load and pass it to `createTerrainMesh`.

Conventions: trackDist uses horizontal (x,z) distance; ties irrelevant; no rounding; inputs not mutated; boundary `trackDist < 60` strict.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/081-terrain-material.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | terrain 8 m grid around the circle fixture (R 100, N 120) | terrainTrackDistance | vertex nearest the circle centre: 100 ± 6; any vertex on the circle: ≤ 6 |
| AT2 | same | far vertex (≥ 300 m away) | exactly 200 (cap) |
| AT3 | createTerrainMesh(terrain, material, trackDist) | geometry | attribute 'trackDist' itemSize 1, count = (rows+1)·(cols+1), values equal input |
| AT4 | createTerrainMaterial(stub loader) | onBeforeCompile on a fake standard shader | uniforms include uGrassA, uGrassB, uGrassC, uDirt, uMacro; vertexShader contains 'trackDist' |
| AT5 | stub loader | createTerrainMaterial | colour URLs loaded: textures/grass-mown, textures/grass, textures/grass-dark, textures/dirt, textures/macro-noise.png |
| AT6 | e2e `/?track=spa` | ready | no console errors, no /textures/ 404 |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass; existing terrain tests still pass (trackDist optional).

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Track-surface materials (080), markings (082), trees/scenery, terrain regeneration, new textures, physics changes, LOD or terrain chunking.

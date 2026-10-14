# 158 — City renderer: buildings, facades, water

Status: pending
Phase: 1
Depends on: 157, 099
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

City tracks render extruded OSM buildings with facade textures, stone old-city walls and animated water.

## Context

M1.2d, design `docs/plans/m1.2d-environments.md`. Read the current code first: this task runs after 157 (`public/tracks/<id>-env.json`, `CityEnv` type from `tools/env/osmBuildings.ts`) and 099 (HDRI sky, `src/render/environment.ts`); adapt file names to what exists, keep the public contract. Copy the type into `src/core/types.ts` as `CityEnv` (render code must not import from `tools/`). Facade textures installed by the planner: `public/textures/facade/{glass-a,glass-b,glass-c,brick}/` and `public/textures/stone/old-wall/` (color/normal/roughness `.jpg`). Water normal map is generated at runtime (canvas/DataTexture, no asset). Simulation code stays free of `three`. Dispose geometries/materials/textures once; load textures through an optional `loadTexture` parameter as in `terrainMaterial.ts`. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/render/cityRenderer.ts` — create.
- `src/core/types.ts` — modify: `CityEnv`.
- `src/main.ts` — modify: fetch `tracks/<id>-env.json` (ignore 404), build, add to scene, update water each frame, dispose; `SceneStats` adds `buildings: number`.
- `tests/unit/acceptance/158-city-renderer.test.ts`, `tests/e2e/acceptance/158-city-renderer.spec.ts` — create (acceptance worker).

## Steps

```ts
export interface CityObject { group: THREE.Group; buildings: number; update(timeSeconds: number): void; dispose(): void }
export function extrudeBuilding(ring: [number, number][], height: number, baseY: number): THREE.BufferGeometry;
export function createCityObject(
  env: CityEnv,
  terrainY: (x: number, z: number) => number,
  loadTexture?: (url: string) => THREE.Texture,
): CityObject;
export const CITY_CELL = 200; // metres
```

1. `extrudeBuilding`: walls (2 triangles per ring edge) + flat roof (triangulated with `THREE.ShapeUtils.triangulateShape`); ring may be given open or closed; reverse to the orientation that faces outward; vertex y from `baseY` to `baseY + height`. UVs in metres: u = cumulative perimeter / 4, v = (y − baseY) / 3.2 (one facade row = one floor). Roof UVs = XZ / 4.
2. `baseY` = minimum of `terrainY` over the ring vertices.
3. Merge by (material, cell) where cell = floor(centroid / CITY_CELL) per axis; one `THREE.Mesh` per non-empty group, one shared `MeshStandardMaterial` per material (glass uses a random-looking pick of glass-a/b/c per cell, reusing the three materials; concrete uses glass-c tinted grey 0x9a9a9a; brick; stone). Frustum culling on.
4. Walls: each `walls[i].line` extruded as a box strip (width = thickness, height) in the stone material.
5. Water: one plane (triangulated polygon) per polygon at y = min terrain height − 0.3, semi-transparent blue material with a generated tiling normal map; `update(t)` scrolls the normal map offset by t × 0.02 (no allocations).
6. `buildings` = total building count in `env.buildings`. Empty env → empty group.
7. `dispose()` once; second call no-op.

Conventions: heights/lengths in metres; degenerate ring (< 3 distinct points) skipped and not counted; cell index uses floor (negative coordinates included); inputs not mutated; no per-frame allocations.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: square ring 10 × 10, height 20 | extrude | 8 wall triangles + 2 roof triangles; wall v range 0..6.25 (± 1e-6) |
| AT2 | unit: 100 buildings across 2 cells, 2 materials | build | ≤ 4 meshes |
| AT3 | e2e `/?track=singapore` | ready | `sceneStats().buildings` = buildings in singapore-env.json; `drawCalls()` ≤ 300; no console errors |
| AT4 | e2e baku start screenshot, band y 120–260 | pixels | ≥ 25 % non-sky (luminance differs from the row's sky colour by > 0.1) |

## Acceptance criteria

- [ ] AT1–AT4 pass; tracks without an env file load unchanged (monza e2e still passes).
- [ ] typecheck, lint, test, test:e2e pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 158-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Baking data (157), lamps/sidewalks/billboards (159), landmarks (160).
- Window lights at night, reflections, building LOD, collision with buildings.

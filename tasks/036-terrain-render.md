# 036 — Render the terrain mesh

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`createTerrainMesh(terrain)` builds a Three.js mesh of the `Terrain` heightfield that matches the Rapier collider exactly.

## Context

`Terrain` type and Rapier layout: `ai/guides/phase1.md` (TrackData v2, Verified facts). Must run in Node (no WebGL, no DOM). Acceptance tests: Vitest in `tests/unit/acceptance/036-terrain-render.test.ts`.

## Files

- `src/render/terrainRenderer.ts` — create
- `tests/unit/render/terrainRenderer.test.ts` — create (edge cases)

## Steps

```ts
import * as THREE from 'three';
import type { Terrain } from '../core/types';
export function createTerrainMesh(terrain: Terrain, material?: THREE.Material): THREE.Mesh;
```

- Vertices: `(rows + 1) * (cols + 1)`; vertex index `i * (cols + 1) + j` for row `i`, column `j`.
- Position: `x = originX - sizeX/2 + j * sizeX/cols`, `z = originZ - sizeZ/2 + i * sizeZ/rows`, `y = heights[j * (rows + 1) + i]` (Rapier column-major layout).
- Triangles: 2 per cell, counter-clockwise seen from +Y. Normals via `computeVertexNormals()`.
- uv = `(x / 10, z / 10)` using the world x and z; texture repeat is the material's business.
- Default material (when none given): `MeshStandardMaterial`, colour `0x4a7a3a`, no textures. A passed material is not disposed by the mesh owner here.
- Mesh `name = 'terrain'`, `receiveShadow = true`. Throws `Error('createTerrainMesh: invalid terrain')` if `heights.length !== (rows+1)*(cols+1)`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/036-terrain-render.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | fixture Terrain 4×4 | `createTerrainMesh(terrain)` (Node) | geometry vertex count 25; vertex at (row i, col j) has y = heights[j*(rows+1)+i] and x/z per Rapier layout ±1e-6 |
| AT2 | same | normals | computed, all y > 0 for a flat terrain |
| AT3 | same | uv | repeats every 10 m (uv = x/10, z/10) |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/036-terrain-render.test.ts` pass.
- [ ] Extra tests: wrong `heights.length` throws; every triangle has normal y > 0 on flat terrain; index count = `rows * cols * 6`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Terrain textures (the caller passes a material; task 043 wires it).
- LOD, chunking, or splatting.
- Adding the mesh to a scene.

# 037 — Render track surfaces with textures

Status: pending
Phase: 1
Depends on: 022, 031, 035
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`createTrackSurfaceObject(strips)` turns the `SurfaceStrip[]` of task 031 into textured Three.js meshes with proper disposal.

## Context

`SurfaceStrip` is a core type (`src/core/types.ts`, task 022); the strips come from `buildTrackSurfaces` (task 031), used by tests only. `render` imports nothing from `track`. Textures from task 035: `textures/<surface>/color.jpg`, `normal.jpg`, `roughness.jpg` (relative URLs, served from `public/`), surfaces `asphalt`, `gravel`, `runoff` (see `docs/research/track-textures.md`). Must run in Node. Acceptance tests: Vitest in `tests/unit/acceptance/037-track-surface-render.test.ts`.

## Files

- `src/render/trackSurfaceRenderer.ts` — create
- `tests/unit/render/trackSurfaceRenderer.test.ts` — create (edge cases)

## Steps

```ts
import * as THREE from 'three';
import type { SurfaceStrip } from '../core/types';
export interface TrackSurfaceOptions { loadTexture?: (url: string) => THREE.Texture }
export interface TrackSurfaceObject { group: THREE.Group; dispose(): void }
export function createTrackSurfaceObject(strips: SurfaceStrip[], options?: TrackSurfaceOptions): TrackSurfaceObject;
```

- One `THREE.Mesh` per surface present in `strips`, strips of the same surface merged into one `BufferGeometry` (indices offset). Mesh names: `asphalt`, `kerbs` (surface `kerb`), `runoff`, `gravel`; positions/uvs/indices copied from the arrays (counts must match the inputs summed). `receiveShadow = true`.
- Asphalt, gravel, runoff: `MeshStandardMaterial` with `map` (color, sRGB), `normalMap`, `roughnessMap` from `textures/<surface>/{color,normal,roughness}.jpg`, `RepeatWrapping` on both axes (uv already is in 10 m units).
- Kerbs: `MeshStandardMaterial` whose `map` is a 1×2 `DataTexture` (red `#cc2222`, white `#eeeeee`), `NearestFilter`, `RepeatWrapping`, `repeat.y = 0.5`, so one stripe per uv.v unit.
- Default `loadTexture`: `THREE.TextureLoader().load(url)` when `typeof document !== 'undefined'`, otherwise an empty `new THREE.Texture()`; in both cases set `texture.name = url`.
- `dispose()` disposes every geometry, material and texture created or loaded here (including `DataTexture`), once; calling it twice is safe.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/037-track-surface-render.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | surfaces from 031 fixture | `createTrackSurfaceObject` (Node) | group with meshes named asphalt, kerbs, runoff, gravel; geometry counts match the input arrays |
| AT2 | same | materials | asphalt/gravel/runoff use textures from `public/textures/*`; kerbs use a red/white stripe material driven by uv.v |
| AT3 | same | `dispose()` | disposes all geometries, materials and textures (spies) |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/037-track-surface-render.test.ts` pass.
- [ ] Extra tests: surfaces absent from the input create no mesh; empty `strips` gives an empty group; second `dispose()` does not throw.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Downloading textures (task 035).
- Terrain, barriers, trees.
- Scene wiring and shadows setup (task 043).
- Anisotropy or mipmap tuning.

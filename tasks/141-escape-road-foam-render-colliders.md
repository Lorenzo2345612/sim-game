# 141 — Render and colliders for escape roads and foam block barriers

Status: pending
Phase: 1
Depends on: 140, 103
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Escape roads (`TrackDataV2.escapeRoads`) are drivable, rendered asphalt strips with `runoff` grip, and `foam` barrier segments render as instanced blue/red/white foam blocks and collide like other barriers.

## Context

M1.2c. Data comes from 140 (`EscapeRoad`, `BarrierSegment.type = 'foam'`; `escapeRoads` is optional: treat `undefined` as `[]`). Escape roads join `buildTrackSurfaces` (`src/track/surfaces.ts`) as extra `SurfaceStrip`s, so the existing `createTrackSurfaceObject` and `addTrackColliders` handle render and Rapier automatically (no change in `trackColliders.ts`; `barrierRuns` already carries any barrier type, so foam collides like armco). `clampTerrainBelowStrips` uses `buildTrackSurfaces`, so terrain under escape roads changes: regenerate tracks. Foam follows task 103's approach: shared geometry, `InstancedMesh`, `loadTexture` optional param, dispose-once rule (see `tasks/103-trackside-realism.md`). Barrier "behind" = outward normal of the side. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/track/surfaces.ts` — modify: `buildTrackSurfaces` appends escape-road strips.
- `src/render/barrierRenderer.ts` — modify: foam blocks; `BarrierObject.foamBlocks`.
- `src/main.ts` — modify: `SceneStats` gets `foamBlocks`, `escapeRoads`.
- `public/tracks/*.json` — regenerate (`npm run build:tracks`, all ten ids) after the surfaces change.
- `tests/unit/acceptance/141-escape-foam.test.ts`, `tests/e2e/acceptance/141-escape-foam.spec.ts` — create (acceptance worker).
- Planner-authorised minimal edits to existing tests broken only by regeneration (terrain heights / strips); report each.

## Steps

```ts
// surfaces.ts (exported, also called inside buildTrackSurfaces)
export function escapeRoadStrips(track: TrackDataV2): SurfaceStrip[]; // [] when escapeRoads missing/empty
// barrierRenderer.ts
export interface BarrierObject { group: THREE.Group; foamBlocks: number; dispose(): void }
export const FOAM_PITCH = 1.0, FOAM_HEIGHT = 1.0, FOAM_DEPTH = 0.6, FOAM_WIDTH = 0.96;
// main.ts: SceneStats adds foamBlocks: number; escapeRoads: number
```

1. Escape strip: one `SurfaceStrip` with `surface: 'runoff'` per road. Each polyline point yields two vertices at ±width/2 along the unit lateral (right normal; averaged from adjacent segments at inner points), so the cross-section distance is width ± 1e-6. Vertex y = `elevation[nearest centerline index by XZ distance] + 0.01`. Triangles wound so normals face +Y (a downward Rapier ray must hit). uv as the existing run-off strips (metres / UV_SCALE).
2. Foam spans (`type === 'foam'`) get their own branch in `createBarrierObject` (today the non-armco/non-tyre branch is the wall; foam must not fall into it). Per span path, block k (k = 0 … floor(length / FOAM_PITCH) − 1) is centred at arc length (k + 0.5)·FOAM_PITCH, yawed along the path tangent, box FOAM_WIDTH × FOAM_HEIGHT × FOAM_DEPTH, base at path y, shifted outward by FOAM_DEPTH/2 so the inner face is flush with the barrier line.
3. Colour = (running block counter over the whole barrier object) mod 3 → blue `0x1f4fbf`, red `0xcc2222`, white `0xf0f0f0`. One `InstancedMesh` per colour that has ≥ 1 block, named `foamBlue`, `foamRed`, `foamWhite`, shared box geometry, one `MeshStandardMaterial` per colour (roughness 0.6, metalness 0). No foam spans → no foam meshes, `foamBlocks` 0. `foamBlocks` = total instances.
4. `dispose()` disposes the foam geometry and the three materials exactly once; second call no-op.
5. `main.ts`: `foamBlocks = barriers.foamBlocks`, `escapeRoads = track.escapeRoads?.length ?? 0` (0 for V1 tracks).
6. Regenerate all ten tracks after step 1 so terrain is clamped below the escape strips.

Conventions: lengths in metres along the XZ polyline; block count uses floor (a remainder < 1 m gets no block); zero-length span creates no blocks; colours exact in linear RGB via `THREE.Color`; no per-frame allocations.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: foam barrier along a 10 m straight segment | build | 10 blocks (1.0 m pitch), height 1.0 ± 0.02 m, colours cycling blue, red, white; one InstancedMesh per colour |
| AT2 | unit: escape road polyline of 3 points, width 8, flat elevation 5 | build mesh | cross-section width 8 ± 1e-6 at every point; vertex y = 5.01 ± 1e-6 |
| AT3 | Rapier: monza.json via addTrackColliders | ray down at the middle point of the first escape road / ray outward across a `foam` segment at y + 0.5 | hits with surfaceOf = 'runoff' / hits a barrier collider (surfaceOf null) |
| AT4 | e2e `/?track=monza` | ready | `sceneStats().foamBlocks` > 0, `sceneStats().escapeRoads` ≥ 1; `drawCalls()` ≤ 300; no console errors |

## Acceptance criteria

- [ ] AT1–AT4 pass; 038, 083, 086, 103 barrier tests still pass.
- [ ] All ten `public/tracks/*.json` regenerated; `npm run typecheck`, `lint`, `test`, `test:e2e` pass.

## Verification

```
npm run build:tracks
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Builder rules and data (140); tyre/armco/wall changes; kerbs or markings on escape roads; damage/deformation; foam textures; trimesh changes in `trackColliders.ts`; README/tasks.json.

# 032 — Terrain, surface and barrier colliders

Status: pending
Phase: 1
Depends on: 022, 031
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, tester-pre, tester, reviewer

## Goal

`createPhysicsWorld(track?)` builds a Rapier world with a terrain heightfield, trimesh colliders for every surface strip and barrier walls, and `surfaceOf(collider)` tells which surface a collider is.

## Context

Design and verified Rapier heightfield/trimesh facts: `ai/guides/phase1.md` (Verified facts, Runtime). Rapier basics: `ai/guides/architecture.md`. Reference experiment: `ai/lab/terrain-colliders.mjs`. Acceptance tests: Vitest in `tests/unit/acceptance/032-physics-track-colliders.test.ts`; tests build a small `TrackDataV2` fixture and call `createPhysicsWorld(track)`.

## Files

- `src/physics/trackColliders.ts` — create
- `src/physics/physicsWorld.ts` — modify
- `tests/unit/physics/trackColliders.test.ts` — create (edge cases)

## Steps

```ts
// trackColliders.ts
import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
import { buildTrackSurfaces } from '../track/surfaces';   // task 031 (physics → track: see architecture gap)
export function addTrackColliders(world: RAPIER.World, track: TrackDataV2, strips: SurfaceStrip[] = buildTrackSurfaces(track)): void;
export function surfaceOf(collider: RAPIER.Collider): Surface | null;
// physicsWorld.ts
export function createPhysicsWorld(track?: TrackDataV2): RAPIER.World;
```

- `createPhysicsWorld()` without `track` is unchanged (Phase 0 flat cuboid ground, `surfaceOf` of it = `null`). With `track`: do NOT create the flat ground; call `addTrackColliders`.
- Terrain: `ColliderDesc.heightfield(rows, cols, Float32Array(heights), { x: sizeX, y: 1, z: sizeZ })` translated to `(originX, 0, originZ)`. Heights are absolute world y (layout in phase1.md). Surface = `'grass'`.
- Surfaces: one `ColliderDesc.trimesh(positions, indices)` per strip in `strips`; surface = `strip.surface`.
- Barriers: one trimesh for all `track.barriers`. For each segment (index range `start…end`, wrapping when `end < start`) the polyline is `P[i] + side × offsetMeters × rightNormal[i]` (right normal as in `buildRibbon`; left = negative). Wall quads per consecutive pair: bottom `y = elevation[i] - 0.3`, top `y = elevation[i] + 1.0`. These colliders map to no surface (`surfaceOf` = `null`).
- `surfaceOf` uses a module-level `Map<number, Surface>` keyed by `collider.handle`, cleared at the start of every `addTrackColliders` call (one track world at a time). Unknown handle → `null`.
- Triangles of surface strips are CCW seen from +Y (rays from above hit them).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/032-physics-track-colliders.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `createPhysicsWorld()` (no track) | drop a 1 m cube | rests at y 0.5 ±0.05 (Phase 0 behaviour kept) |
| AT2 | fixture TrackDataV2 with terrain sloped 0.1 m/m along x | raycast down at a terrain point | hit height = terrain value ±0.05 |
| AT3 | same | raycast at a centerline point | hits an asphalt collider: `surfaceOf(collider)` = 'asphalt'; y = elevation + 0.02 ±0.02 |
| AT4 | fixture with a gravel runoff | raycast in the runoff | `surfaceOf` = 'gravel' |
| AT5 | barrier right at 11 m | car body driven sideways at 10 m/s toward it | stops before x crosses the barrier line (does not pass through) |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/032-physics-track-colliders.test.ts` pass.
- [ ] Existing tests that call `createPhysicsWorld()` still pass unchanged.
- [ ] Extra tests: `surfaceOf` returns `'grass'` for a raycast hit on terrain away from the track, `null` for a barrier hit, `null` for the Phase 0 ground.
- [ ] `world.free()` leaves no errors across consecutive worlds (create two in sequence).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Per-wheel grip or drag (task 033).
- Passing the track from `Game` (task 043); tree or grandstand colliders; changing `vehicle.ts`.

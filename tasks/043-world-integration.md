# 043 — Load a TrackData v2 world into the game

Status: pending
Phase: 1
Depends on: 056, 038, 039, 040, 041, 042
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Task 056 already loads terrain, surfaces and physics. This task adds the scenery on top: barriers (038), trees (039), grandstands (040), pit building and start gantry/lights (041), sky/fog/shadows (042), and the debug getters `sceneStats()` and `drawCalls()`.

`/?track=<id>` loads `public/tracks/<id>.json` (v2) and shows terrain, textured surfaces, barriers, trees, grandstands, pit, gantry and environment, with the car driving on the track physics.

## Context

Acceptance tests for this task are Playwright in `tests/e2e/acceptance/043-world-integration.spec.ts`. Design: `ai/guides/phase1.md` (Runtime). Read the exported signatures of specs 031, 032, 036, 037, 038, 039, 040, 041, 042 and use them as written. `main.ts` is the only wiring place. Default track when the query is missing or unknown: `monza`. Task 044 (menu) later replaces the query default.

## Files

- `src/main.ts` — modify: parse `?track=`, load v2 JSON, build the world, extend `window.__SIMGAME__`
- `src/game/game.ts` — modify: `Game.create(track: TrackData | TrackDataV2)` calls `createPhysicsWorld(track)` for v2 (`'version' in track`), unchanged for v1; `spawnFromTrack(track: TrackData | TrackDataV2)` uses y = `elevation[N-5] + 0.6` when `elevation` exists; new `getWheelSurfaces(): Surface[]` forwarding to the vehicle
- `tests/unit/game/gameSpawn.test.ts` — create (spawn y with elevation 12 at index N-5 = 12.6 ±1e-9)

## Steps

```ts
// additions to Window.__SIMGAME__
trackId(): string;
carPosition(): Vec3;            // current chassis position (used by e2e checks of 043 and 055)
surfaceUnderCar(): Surface;   // majority of `game.getWheelSurfaces()`; 'asphalt' when none
```

- Scene: `createScene()`, then `applyEnvironment(scene, track.id)`, `ShadowRig` (enabled), hide `ground`. Add: `createTerrainMesh` (material with the `textures/grass/*` set, `RepeatWrapping`, repeat so one tile ≈ 10 m), `createTrackSurfaceObject(buildTrackSurfaces(track))`, `createBarrierObject(track)`, `createTreeField` (`terrainY` bilinear from `track.terrain`; `update(camera.position)` once per frame), one `createGrandstand` per `track.grandstands` (set y from nearest centerline elevation), `createPitBuilding`, `createStartGantry`, `createStartLights` (keep `setLights(0)`).
- Car and track meshes: `castShadow` true for the car; `receiveShadow` true for terrain and surfaces. `ShadowRig.update(car position)` every frame.
- Camera: ChaseCamera as today. Status text stays until everything is added; no console errors.
- On load failure show the error in `#status` (existing `onError`).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/e2e/acceptance/043-world-integration.spec.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: `/?track=monza` | ready | `__SIMGAME__.sceneStats()` reports barriers > 0, tree instances = trees in monza.json, grandstands = grandstands in monza.json, pit building 1, start gantry 1; no console errors |
| AT2 | e2e: same, screenshot from the start line, 1280×720 | pixels in the band y 200–280, x < 300 | ≥ 30 % have G > R and luminance < 0.5 (trees visible) |
| AT3 | e2e: same | `__SIMGAME__.drawCalls()` | ≤ 300 |
| AT4 | e2e: `/?track=spa` | ready | sky present (`sceneStats().sky` true), shadows enabled, no console errors |

## Acceptance criteria

- [ ] All AT rows pass with `npm run test:e2e`.
- [ ] Phase 0 e2e (`tests/e2e/phase0.spec.ts`) still passes, adapted only if it asserts v1 things that no longer hold (state it in the report).
- [ ] `npm test` passes.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Menu, gearbox, cameras, HUD v2, minimap, ghost, audio, presets (tasks 044–054).
- Changing the modules from tasks 031–042 (report gaps instead).

# 056 — Load TrackData v2 tracks into the game (terrain, surfaces, physics)

Status: pending
Phase: 1
Depends on: 030, 032, 033, 034, 035, 036, 037
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`npm run dev` (and the built game) loads `/tracks/<id>.json` v2 chosen with `?track=monza|spa|silverstone` (default monza) and shows the textured terrain and track surfaces with elevation; the car drives on the track physics (heightfield + surface colliders + barriers) with surface grip and track limits. No trees, grandstands, pit building or menu yet (task 043/044).

## Context

Design: `ai/guides/phase1.md`. Read the specs of 030, 031, 032, 033, 034, 036, 037 for the exact exports. Keep Phase 0 behaviour working when a v1 track is loaded. Acceptance tests are Playwright in `tests/e2e/acceptance/056-track-integration.spec.ts`.

## Files

- `src/main.ts` — modify: read `?track=`, fetch the v2 track, build terrain mesh (036) + track surface object (037), create the game with track physics
- `src/game/game.ts` — modify: `Game.create(track: TrackData | TrackDataV2)` uses `createPhysicsWorld(track)` for v2; `getWheelSurfaces()`; spawn uses elevation
- `tests/e2e/acceptance/056-track-integration.spec.ts` — created by the acceptance worker

## Steps

1. `window.__SIMGAME__` gains `trackId(): string`, `surfaceUnderCar(): Surface`, `carPosition(): {x, y, z}`, `trackHeightUnderCar(): number` (track or terrain surface y at the car's x/z, from a downward physics raycast).
2. Spawn: `spawnFromTrack` places the car at `elevation[N−5] + 0.6`.
3. HUD shows "Lap invalid" text when the lap is invalidated (simple text in the existing HUD lap row is enough).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: `/?track=monza` | ready | `__SIMGAME__.trackId()` = 'monza'; no console errors |
| AT2 | e2e: same, screenshot at start | pixel under the car (640, 690) | asphalt (R, G, B < 90, G − R < 25) |
| AT3 | e2e: `/?track=spa` after 3 s throttle | car y | follows elevation: \|carPosition().y − trackHeightUnderCar()\| < 0.8 m |
| AT4 | e2e: Monza | `surfaceUnderCar()` at start | 'asphalt' |
| AT5 | e2e: `/?track=silverstone` | ready | trackId 'silverstone'; HUD visible; speed > 30 km/h after 3 s throttle |
| AT6 | e2e: `/` (no query) | ready | trackId 'monza' |

## Acceptance criteria

- [ ] AT1–AT6 pass; Phase 0 e2e and all unit tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

Trees, barriers rendering, grandstands, pits, sky/shadow changes, menus, gearbox, gamepad, new cameras.

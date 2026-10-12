# 054 — Wire gameplay features into the game

Status: pending
Phase: 1
Depends on: 034, 042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The browser game uses gearbox, gamepad, camera modes, HUD v2, minimap, ghost, engine audio and graphics presets together.

## Context

Pure wiring in `src/main.ts` (the only file allowed to touch every layer, see `ai/guides/architecture.md`). All feature modules already exist (tasks 042-052); do not change their APIs. Acceptance tests for this task are Playwright in `tests/e2e/acceptance/054-gameplay-integration.spec.ts`. Debug state is read through `window.__SIMGAME__`.

## Files

- `src/main.ts` — modify — wiring.
- `src/game/game.ts` — modify — only add getters/methods listed below (gear, rpm, sector data) and `teleportToIndex(i)`; no behaviour change.

## Steps

- Input: every frame call `gamepad.update(dt)`, then `mergeInputs(keyboard, gamepad)`. Keys (edge only): `C` → `CameraRig.next()`; `Q` → `vehicle.shiftDown()`, `E` → `vehicle.shiftUp()` (gamepad shift flags do the same); `M` toggles `setGearMode` auto/manual (default auto).
- Camera: replace the direct chase camera by `CameraRig`, updated each render frame with the interpolated state.
- HUD: replace `Hud` by `HudV2` (import `hudV2.css`); fill `HudV2Data` each frame: gear, rpm, `sectorTimes` of the current lap and `bestSectorTimes` (from `sectorCompleted` events), `lapValid` from `LapInfo.valid`, `deltaSeconds` = current lap time minus the ghost's time at the same track progress (null without ghost).
- Minimap: `new Minimap(container, track.centerline)`; `update(car x, z)` per frame.
- Ghost: `GhostRecorder.start()` on lap start, `record` every fixed step, `finishLap(valid, lapTime)` on lap completion, `saveGhostIfFaster` with `localStorage`; `loadGhost` on boot; translucent ghost car at `ghostAt(currentLapTime)`.
- Audio: `EngineAudio` created at boot, `resume()` on first keydown/click/gamepad press, `update(rpm, throttle, slips)` per frame (slip ratios 0 where unavailable).
- Presets: preset = `?preset=` query if valid, else `loadPreset(localStorage)`; apply `presetSettings(preset, devicePixelRatio)`: pixel ratio, `ShadowRig.setEnabled`, tree `farDistance`; antialias is ignored. `FpsOverlay(document.body, window)` updated per frame with fps and `renderer.info.render.calls`.
- Pause (`Esc`, task 044) stops `simTime`; rendering continues.
- Extend `window.__SIMGAME__` (existing: `getSpeedKmh`, `getLap`, `getSimTime`, `trackId`, `carPosition`, `surfaceUnderCar`) with: `cameraMode(): CameraMode`, `gear(): number`, `preset(): Preset`, `drawCalls(): number`, `teleportToIndex(i: number): void` (car on centerline point `i`, facing the next point, y = elevation + 0.6, zero velocity; used by task 055 AT4).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/e2e/acceptance/054-gameplay-integration.spec.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e Monza | press C twice | `__SIMGAME__.cameraMode()` = 'cockpit' |
| AT2 | e2e hold ArrowUp 6 s | `gear()` | ≥ 3; HUD gear text equals it |
| AT3 | e2e | minimap canvas | visible top-right, non-empty pixels |
| AT4 | e2e | Esc | pause menu visible; simTime does not advance while paused |
| AT5 | e2e | console | no errors during 10 s of driving |
| AT6 | e2e `/?track=monza&preset=low` | ready | `__SIMGAME__.preset()` = 'low' and shadows disabled |

## Acceptance criteria

- [ ] All AT rows pass in Playwright; `npm test` still passes.
- [ ] No console errors during 10 s of driving.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- New features, balancing, F4 car (task 053), changing module APIs from tasks 044-052.


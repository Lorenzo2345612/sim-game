# 093 — Multi-car race game

Status: pending
Phase: 2
Depends on: 008, 043, 065, 070, 073, 087, 088, 089, 090, 091, 092, 169
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`RaceGame` runs a player plus up to 15 AI cars on the grid with start lights, car-to-car collisions, classification and stuck-car respawn; `/?race=1` starts it in the browser.

## Context

Generalises the single-car `Game` (`src/game/game.ts`; behaviour stays unchanged). The car is `VehicleModel` (`src/physics/vehicleModel.ts`, 169/070; `src/physics/vehicle.ts` only re-exports it as `Vehicle`): `new VehicleModel(world, spec, spawn)`, `setInput`, `prePhysicsStep`, `getState`, `reset(spawn)`, `getTelemetry().fuelKg`. Cars load from `public/cars/<id>.json` via `parseCarSpec` (`src/physics/carSpec`). Existing APIs: `AiDriver(line, speeds, params?: Partial<AiParams>)`: `setLateralOffset`, `setSpeedCap`, `update(obs, dt, out)` (`src/ai/aiDriver`); `trafficDecision(self, others, lapLength, halfWidth, lineOffsetAhead, curvatureAhead)`, `difficultyParams(d)` (`src/ai/traffic`); `computeRacingLine(centerline, halfWidth)` and `mengerCurvature(ax,az,bx,bz,cx,cz)` (`src/ai/racingLine`); `carLimitsFromSpec(spec, fuelKg)`, `speedProfile(line, lim)` (`src/ai/speedProfile`); `new StartSequence(rng)` (`update(dt)`, `phase`, `lights`, `goTime`), `isJumpStart(moved, phase)` (`src/race/startSequence`); `gridSlots(track, count)` (`src/race/grid`); `new RaceClassification(carCount, laps, lapLength)` (`update(car, lapDistance, time)`, `addPenalty`, `standings()`, `finished`) (`src/race/classification`); `new TrackProgress(centerline)` (`src/track/trackProgress`, `update(x,z)` returns a reused `{index, distance, lateral}`). Track loading in tests: `parseTrackData(JSON)` from `src/track/parseTrackData`. Seeded mulberry32 from `config.seed` (a local copy in `raceGame.ts`; no `Math.random`). Acceptance tests: Vitest `tests/unit/acceptance/093-race-game.test.ts` (AT1-AT4, Node) and Playwright `tests/e2e/acceptance/093-race-game.spec.ts` (AT5).

## Files

- `src/game/raceGame.ts` - create
- `src/game/game.ts` - modify: extract two exported helpers used by `Game.create`/`Game.step` and `RaceGame` (no behaviour change): `configureVehicle(vehicle: VehicleModel, trackId: string, tune?: GameTune): TrackConditions` (applies `setCompound`/`setMultipliers` when `tune` is given, then `setTrackConditions(conditionsFor(trackId))`) and `class AutoReverse { update(vehicle: VehicleModel, input: DriverInput, forwardSpeed: number): void }` (the auto-mode reverse rule of `Game.step`, task 178)
- `src/physics/vehicleModel.ts` - modify: the chassis collider (~line 190) gets a collision group; both `world.castRayAndGetNormal` wheel-ray calls (~343 and ~599) ignore every car chassis collider (collision-group ray filter), not only their own body; chassis colliders collide with each other; collisions with terrain/track/barriers unchanged
- `src/main.ts` - modify: `?race=1&track=&car=&ai=&laps=&diff=&seed=` starts `RaceGame` (car/spec resolved as in `startGame`); in a race the fixed loop steps `RaceGame` instead of `Game` and the player's camera, HUD (`HudV2`, `Minimap`) and audio follow car 0 (AI cars are drawn by 094; lap timer/ghost/setup hotkeys may stay inert in a race); `__SIMGAME__` gains `raceStandings(): readonly Standing[]`, `carCount(): number`, `startLights(): number`

## Steps

```ts
export interface RaceConfig { trackId: string; carId: string; laps: number; aiCount: number; difficulty: Difficulty; seed: number }
export class RaceGame {
  static create(track: TrackDataV2, spec: CarSpec, config: RaceConfig, tune?: GameTune): Promise<RaceGame>;
  step(playerInput: DriverInput): void;                 // one FIXED_DT tick
  getStates(out: VehicleState[]): VehicleState[];       // index 0 = player; reused objects
  getPrevStates(): readonly VehicleState[];             // for interpolation
  standings(): readonly Standing[];                     // Standing.car = index in getStates (player = 0)
  readonly config: RaceConfig;
  readonly raceFinished: boolean;                       // RaceClassification.finished
  startLights(): number;                                // StartSequence.lights
  readonly simTime: number;
  readonly carCount: number;
  dispose(): void;
}
```

Types: `Difficulty` from `src/ai/traffic`, `Standing` from `src/race/classification`, `CarSpec` from `src/physics/carSpec`, `GameTune` from `src/game/game`, `DriverInput`, `VehicleState`, `TrackDataV2` from `src/core/types`. `main.ts` builds `tune` and the player's `spec` exactly as `startGame` does (`loadSetup`/`applySetup`).

1. Per-car setup = same as `Game.create`: `initPhysics()`, `createPhysicsWorld(track)`, one `VehicleModel` per car, `configureVehicle` on every car, state buffers via `createVehicleState(4)`. The player (index 0) additionally applies `AutoReverse` each tick (default gearbox mode of `VehicleModel`, as `Game`).
2. aiCount clamped 0-15; slots from `gridSlots(track, aiCount + 1)`; the player takes the LAST slot, AI cars slots 0.. in order (AI k = index k+1). All cars use the same `CarSpec`. One racing line (`computeRacingLine(track.centerline, track.widthMeters/2)`) + `speedProfile(line, carLimitsFromSpec(spec, fuelKg))` (`fuelKg` = player `getTelemetry().fuelKg`) shared; per AI an `AiDriver` with `speedScale` from `difficultyParams` plus seeded jitter in [-0.01, 0.01].
3. Before 'go' every car gets brake 1 (player throttle passes through, AI throttle 0; player steering ignored). At 'go' normal control. Jump start: `isJumpStart` on the horizontal (x, z) distance moved from the slot (suspension settle in y is ignored); each car penalised once with `addPenalty(car, 5)`.
4. Per tick per AI: `TrackProgress` (index = racing-line point index) -> `trafficDecision` (halfWidth = `widthMeters/2`, `lineOffsetAhead` = `line.offsets` ~30 m ahead, `curvatureAhead` = `mengerCurvature` of line points there; `AiObservation.yaw = atan2(-fx,-fz)` from the state quaternion, `speed = forwardSpeed`) -> `setLateralOffset`/`setSpeedCap` -> `update` -> `setInput`. Then step the world once and update `RaceClassification` with each car's lap distance and `simTime - goTime` (time 0 = go; before go, while `goTime` is null, time = 0). Cars start behind the line.
5. Stuck: an AI car with speed < 1 m/s for 5 s after go is `reset` onto the centerline at its progress, facing along the track (AI only; player never).
6. `mistakesPerLap` is NOT implemented. `RaceGame.create` works in Node (no WebGL); tests load spec/track from `public/` with `fs`.

Conventions: deterministic (same config -> identical results); `step` after `dispose` throws; invalid `aiCount` is clamped, never throws; no per-tick allocation in the AI loop.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node, monza, aiCount 5, difficulty medium, seed 1, player input zero | 60 s sim | all 5 AI cars moved > 1 km; no NaN; no car below the terrain |
| AT2 | same, before go | step | every car within 0.5 m of its grid slot |
| AT3 | aiCount 11 | 120 ticks timed in Node | < 2.0 s wall time |
| AT4 | same seed twice | 30 s | identical standings and positions (± 1e-9) |
| AT5 | e2e `/?race=1&track=monza&ai=5` | 20 s after go | `raceStandings()` has 6 entries, positions 1..6 unique; no console errors |

## Acceptance criteria

- [ ] AT1–AT5 pass; existing unit and e2e tests pass (single-car `/?track=` flow unchanged).
- [ ] `grep -rn "Math.random" src/game/raceGame.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 093-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

Rendering AI cars, start-light visuals, HUD (094); menu and results (095); pit stops, damage, mistakes, wheel-to-wheel penalties, ghost, lap timer UI changes, any `Game` behaviour change (the helper extraction is behaviour-neutral).

Frozen tests: none need editing (single-car physics, `Game` and `/?track=` flows are unchanged; verified by grep of `tests/` for vehicleModel/game/main users). If an existing test fails because of the collision-group change, that is a bug in the change, not a test edit.

## Planner-authorised test edit (EDGE8)

`tests/unit/edge/093-race-game-edge.test.ts`: delete the EDGE8 test case (difficulty pace). At speedScale 1.0 the expert AI spins at the first chicane, so it cannot pass with 093's wiring; the check moves to task 225 (AI grip margin). Nothing else in that file. Difficulty wiring stays `speedScale` only.

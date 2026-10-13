# 093 — Multi-car race game

Status: pending
Phase: 2
Depends on: 008, 043, 065, 070, 073, 087, 088, 089, 090, 091, 092
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`RaceGame` runs a player plus up to 15 AI cars on the grid with start lights, car-to-car collisions, classification and stuck-car respawn; `/?race=1` starts it in the browser.

## Context

Generalises the single-car `Game` (`src/game/game.ts`, keep it unchanged and working). Uses `Vehicle` (065/070: constructed from a `CarSpec`, `setInput`, `prePhysicsStep`, `getState`, `reset`), car loading from 073 (`public/cars/<id>.json`), `AiDriver` (089), `trafficDecision`/`difficultyParams` (090), `StartSequence`/`gridSlots`/`isJumpStart` (091), `RaceClassification` (092), `computeRacingLine` (087), `carLimitsFromSpec`/`speedProfile` (088), `TrackProgress`. Conventions as in `docs/plans/phase2-race.md` header (no `Math.random` in sim; seeded mulberry32 from `config.seed`). Acceptance tests: Vitest in `tests/unit/acceptance/093-race-game.test.ts` (AT1–AT4, Node) and Playwright `tests/e2e/acceptance/093-race-game.spec.ts` (AT5).

## Files

- `src/game/raceGame.ts` — create
- `src/physics/vehicle.ts` — modify: wheel rays ignore every vehicle chassis collider (not only their own); chassis collider gets a collision group so cars collide with each other
- `src/main.ts` — modify: `?race=1&track=&car=&ai=&laps=&diff=&seed=` starts `RaceGame`; `__SIMGAME__` gains `raceStandings(): readonly Standing[]`, `carCount(): number`, `startLights(): number`

## Steps

```ts
export interface RaceConfig { trackId: string; carId: string; laps: number; aiCount: number; difficulty: Difficulty; seed: number }
export class RaceGame {
  static create(track: TrackDataV2, spec: CarSpec, config: RaceConfig): Promise<RaceGame>;
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

Types: `Difficulty` from `src/ai/traffic`, `Standing` from `src/race/classification`, `CarSpec` from `src/physics/carSpec`, `DriverInput`, `VehicleState`, `TrackDataV2` from `src/core/types`.

1. Cars: aiCount clamped to 0–15; slots from `gridSlots(track, aiCount + 1)`; the player takes the LAST slot, AI cars slots 0.. in order. All cars use the same `CarSpec`. One racing line (`computeRacingLine(track.centerline, widthMeters/2)`) + speed profile (`carLimitsFromSpec(spec, initial fuel)`) shared; per AI `AiDriver` with `speedScale` from `difficultyParams`; seeded rng gives each AI a small speedScale jitter ±0.01.
2. Before 'go' every car gets brake 1 (throttle passes through, AI throttle 0); steering of the player is ignored. At 'go' normal control. Jump start: `isJumpStart` on distance moved from the slot; each car penalised once with `classification.addPenalty(car, 5)`.
3. Per tick per AI: `TrackProgress` (index = racing-line point index) → `trafficDecision` (halfWidth = `widthMeters/2`, `lineOffsetAhead` = `line.offsets` ~30 m ahead, `curvatureAhead` = `mengerCurvature` of line points there; `AiObservation.yaw = atan2(-fx,-fz)` from the state quaternion, `speed = forwardSpeed`) → → `setLateralOffset`/`setSpeedCap` → `update` → `setInput`. Then step the world once, update `RaceClassification` with each car's lap distance and `simTime − goTime` (time 0 = go). Cars start behind the line.
4. Stuck: an AI car with speed < 1 m/s for 5 s after go is reset onto the centerline at its progress, facing along the track (AI only; player never).
5. Mistakes (`mistakesPerLap`) are NOT implemented here.
6. Vitest: `RaceGame.create` is usable in Node (no WebGL); load spec/track from `public/` with `fs`.

Conventions: deterministic (same config → identical results); `step` after `dispose` throws; invalid `aiCount` is clamped, never throws; no per-tick allocation in the AI loop.

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
npm run test:e2e
```

## Out of scope

Rendering AI cars, start-light visuals, HUD (094); menu and results (095); pit stops, damage, mistakes, wheel-to-wheel penalties, ghost, lap timer UI changes, changes to `Game`.

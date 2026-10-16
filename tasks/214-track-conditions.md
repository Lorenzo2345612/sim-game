# 214 — Track conditions: asphalt abrasion and track temperature

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Each track wears tyres differently (asphalt abrasion) and cools them against its typical track temperature instead of the fixed 25 °C.

## Context

Today `AMBIENT_C = 25` (`src/physics/tyreState.ts`) is fixed and wear scales only with the global `tune.wear`. No weather system exists; "climate" = typical track temperature. Track ids come from `TrackData.id` (`src/core/types.ts`) and `public/tracks/index.json`.

## Files

- `src/track/trackConditions.ts` — create (pure, no `three`).
- `src/physics/tyreState.ts` — modify: `updateTyreState`.
- `src/physics/vehicleModel.ts` — modify: `VehicleModel` (exported as `Vehicle`).
- `src/game/game.ts` — modify: `Game.create`, new getter.
- `tests/unit/acceptance/214-track-conditions.test.ts` — create (acceptance worker).

## Steps

```ts
export interface TrackConditions { abrasion: number; trackTempC: number }
export const DEFAULT_TRACK_CONDITIONS: TrackConditions; // { abrasion: 1, trackTempC: 30 }
export const TRACK_CONDITIONS: Record<string, TrackConditions>;
export function conditionsFor(id: string): TrackConditions; // unknown id -> fresh copy of default
export function trackWearMult(c: TrackConditions): number;
```
1. `TRACK_CONDITIONS` (abrasion/trackTempC) exactly: monza 0.9/35, spa 1.1/25, silverstone 1.25/30, mexico 0.8/40, daytona 1.2/35, lusail 1.3/30, bahrain 1.5/30, braselton 1.15/35, elkhart 1.0/30, sepang 1.3/50, baku 0.75/35, budapest 1.0/50, singapore 0.85/35, lasvegas 0.7/15, spielberg 1.0/35, fontana 1.2/40, fontana-roval 1.2/40, cleveland 1.35/35, detroit 1.2/30.
2. `trackWearMult(c)` = `c.abrasion × clamp(1 + 0.015 × (c.trackTempC − 30), 0.7, 1.5)`.
3. `updateTyreState(...)` gets a final optional param `ambientC: number = AMBIENT_C`; cooling uses it instead of `AMBIENT_C`. Existing callers/tests unchanged.
4. `VehicleModel.setTrackConditions(c: TrackConditions): void` stores `trackWearMult(c)` as a separate multiplier applied on top of `wearMult` (does not replace it; `setMultipliers` works in any order) and `ambientC = c.trackTempC`, passed to both `updateTyreState` calls. Defaults before the call: multiplier 1, ambient `AMBIENT_C`.
5. `Game.create` calls `vehicle.setTrackConditions(conditionsFor(track.id))` always (not only when `tune` is given). `Game` gets `trackConditions(): TrackConditions` returning the applied value.

Conventions: no rounding; clamp bounds inclusive; unknown id returns a copy (never the shared default object); inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `conditionsFor` | 'bahrain', 'lasvegas', 'sepang', 'nope' | {1.5, 30}, {0.7, 15}, {1.3, 50}, {1, 30}; mutating the 'nope' result does not change `DEFAULT_TRACK_CONDITIONS` |
| AT2 | every id in `public/tracks/index.json` | `TRACK_CONDITIONS[id]` | defined; abrasion in [0.6, 1.6]; trackTempC in [10, 55] |
| AT3 | `trackWearMult` | {1,30}, {1.5,30}, {1,50}, {1,10}, {0.7,15}, {1,90}, {1,-40} | 1, 1.5, 1.3, 0.7, 0.5425, 1.5, 0.7 (±1e-12) |
| AT4 | `updateTyreState`, medium F4 compound, state {tempC 90, wear 0}, slipPower 0, speed 0, dt 1, wearMult 1, pressures 140/140 | ambient omitted / 25 / 50 | tempC = 90 − coolCoef×65 (omitted and 25 equal) / 90 − coolCoef×40 (±1e-9) |
| AT5 | two Games on the Elkhart data with f4.json, one with `track.id` overridden to 'bahrain', the other to 'unknown-x'; identical scripted input (full throttle 6 s, then full brake 2 s, steer 0; both stay on asphalt) | after the script | for each wheel, wear_bahrain / wear_unknown = 1.5 (±1e-3 relative); `game.trackConditions()` returns {1.5,30} and {1,30} |
| AT6 | same harness, ids 'sepang' vs 'unknown-x', same script | after the script | mean tyre tempC (4 wheels) of sepang ≥ unknown + 0.3 |

## Planner-authorised test edits

- `tests/unit/acceptance/214-track-conditions.test.ts`: the AT5/AT6 script becomes full throttle 6 s then `{throttle 0, brake 1, steer 0}` 2 s (the old steer 0.3 phase put one car on grass, so wear diverged ×12.8; planner probe: ratios 1.5000–1.5007, sepang +0.58 °C). AT6 threshold 0.5 → 0.3. Nothing else in that file.

## Acceptance criteria

- [ ] All 6 acceptance rows pass.
- [ ] Existing tests still pass: 060 tyre-state (acceptance, edge, post), 065, 066 calibration, 069, 070.
- [ ] `src/track/trackConditions.ts` imports nothing from `three`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- HUD display, rain/weather, time-of-day temperature, rubbering-in, grip changes by asphalt, changes to `tasks.json`/README.

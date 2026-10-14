# 130 — Penalty book, HUD messages and wiring of rules

Status: pending
Phase: 2
Depends on: 089, 092, 093, 094, 095, 127, 128, 129
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`RaceGame` runs track limits, flags and the VSC every tick, applies their penalties through a `PenaltyBook`, makes AI cars react, and the HUD and results show the outcome.

## Context

Design: `docs/plans/game-features.md` section 130. Builds on `TrackLimits` (127, `src/race/trackLimits.ts`), `FlagState` (128, `src/race/flags.ts`), `Vsc` (129, `src/race/vsc.ts`), `RaceGame` (093, `src/game/raceGame.ts`; jump-start penalties currently call `classification.addPenalty` directly), `RaceClassification.addPenalty` (092), `RaceHud` (094, `src/ui/raceHud.ts`), `Results`/`ResultsRow` (095, `src/ui/results.ts`), `AiDriver.setLateralOffset/setSpeedCap` (089, cap applies before `speedScale`). Right normal of travel is + lateral. Acceptance: Vitest `tests/unit/acceptance/130-penalty-book-and-rules-wiring.test.ts` (AT1, AT2), Playwright `tests/e2e/acceptance/130-penalty-book-and-rules-wiring.spec.ts` (AT3, AT4).

## Files

- `src/race/penalties.ts` — create
- `src/game/raceGame.ts` — modify: owns `penalties`, `trackLimits`, `flags`, `vsc`; per-tick rules and AI reactions; hooks
- `src/ui/raceHud.ts` — modify: flags, banners, toasts
- `src/ui/results.ts` — modify: penalty reasons
- `src/main.ts` — modify: `__SIMGAME__` hooks and HUD feed

## Steps

```ts
export type PenaltyReason = 'track limits' | 'yellow flag overtake' | 'VSC delta' | 'jump start';
export interface PenaltyEntry { car: number; kind: 'warning' | 'penalty'; seconds: number; reason: PenaltyReason; time: number }
export class PenaltyBook {
  constructor(carCount: number);
  add(car: number, kind: 'warning' | 'penalty', seconds: number, reason: PenaltyReason, time: number): void; // warnings store seconds 0
  total(car: number): number;                 // sum of seconds of kind 'penalty'
  entries(): readonly PenaltyEntry[];         // insertion order
  forCar(car: number): readonly PenaltyEntry[];
}
```
`ResultsRow` gains optional `penaltyReasons?: string[]`. `RaceGame` gains `readonly penalties: PenaltyBook`, `debugStopCar(car: number): void` (AI only: brake 1 from now, exempt from stuck respawn) and `debugForceTrackLimits(car: number, count: number): void` (calls `TrackLimits.forceStrike` `count` times).

1. Every `'penalty'` entry also calls `classification.addPenalty(car, seconds)`; jump starts go through the book (reason 'jump start', kind 'penalty', 5 s).
2. Per tick after go: `wheelsOff = countWheelsOff(vehicle.getWheelSurfaces())` → `TrackLimits.update` (events become entries with reason 'track limits'); `FlagState.update` with `FlagCar`s (`offTrack` = wheelsOff 4; `retired` from classification); each `overtakeUnderYellow()` entry → +5 s 'yellow flag overtake' for `car`; `Vsc.update(max seconds any car has speed < 1 m/s and !offTrack, time)`; `Vsc.delta` per car each tick; each `drainEvents()` entry → +5 s 'VSC delta'.
3. AI reactions (use `setLateralOffset`/`setSpeedCap`): blue flag → offset 2 m toward the side of the track where the racing line has more room to the edge, and speed cap 0.95 × own profile speed for 3 s; VSC `deployed|ending` → cap 0.6 × profile speed at the car's index; yellow in the car's sector → cap = speed of the nearest car ahead on track while it is within 30 m (no overtakes). Several caps → the minimum.
4. HUD (DOM, inside `RaceHud`): `#flags` with `.flag-s1/.flag-s2/.flag-s3`, each `data-state="green|yellow|double-yellow"`; `#blue-banner` visible while `blueFor(player)`; `#vsc-banner` visible when phase ≠ off, text `VSC +1.2` (delta of the player, sign shown, 1 decimal); toasts in `#toasts` (`.toast`, 4 s each, max 5 stacked): warning → `Track limits n/3`, penalty → `+5 s`.
5. Results: the `.penalty` cell of a row shows `5 s (track limits)` (total seconds and the reasons joined by `, `); no penalties → `-`.
6. `__SIMGAME__`: `raceEvents(): readonly PenaltyEntry[]`, `forceTrackLimits(count: number): void` (player), `finishRaceNow()` already exists (095).

Conventions: deterministic; no `Math.random`; no per-tick allocation in the rules loop; AI never gets a penalty from rules it is exempt from (blue/yellow/VSC reactions must keep it legal); `car` out of range → `RangeError`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: book with 3 warnings + 2 penalties (5 s each) | total(car) | 10 |
| AT2 | Node monza race, 5 AI, seed 1, force one AI stopped on track at 30 s (test hook) | run 60 s | VSC deployed by 40.1 s; every AI's delta ≥ −0.5 s; no AI penalty |
| AT3 | e2e race with `__SIMGAME__.forceTrackLimits(4)` test hook for the player | DOM | toasts for warnings 1–3 then "+5 s"; raceEvents has 4 entries |
| AT4 | e2e results after `finishRaceNow()` | `#results` | penalty column shows 5 s with reason for the player |

## Acceptance criteria

- [ ] All AT rows pass; 093/094/095 tests still pass.
- [ ] `grep -rn "Math.random" src/race src/game/raceGame.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Drive-through/stop-go penalties, time-penalty UI beyond the toast, steward decisions, safety car with a pace car.
- Pit-lane rules (M2.2), replay of penalties.

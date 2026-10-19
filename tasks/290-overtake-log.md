# 290 — Overtake log and grid positions in RaceGame
Status: pending
Phase: 2
Depends on: 289
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, tester-pre, tester, reviewer

## Goal
The race records every committed position change between two cars (who, whom, when, where, and whether it was clean, with contact, or a gift), so the results screen (task 291) can show grid vs final position, overtake counts and a recap per driver.

## Context
Same pass rule as the trainer's `scripts/evolve/racecraft.mts` (task 271), but classifying passes instead of discarding unclean ones. Do not import from `scripts/`. Simulation code: no `three`, no per-step allocation after construction (events array grows only when a pass commits).

## Files
- `src/race/overtakeLog.ts` — create.
- `src/game/raceGame.ts` — modify — feed the log every step after go; car-car contact times; `overtakes` and `gridPosition`.
- `tests/unit/acceptance/290-*.test.ts` — create (acceptance worker).

## Steps
1. Types:
```ts
export type OvertakeKind = 'clean' | 'contact' | 'gift';
export interface OvertakeCar { dist: number; lapDist: number; lap: number; speed: number; running: boolean; position: number; lastContact: number }
export interface OvertakeEvent { t: number; lap: number; lapDistance: number; passer: number; passed: number; position: number; kind: OvertakeKind }
export interface OvertakeSummary { clean: number; contact: number; gift: number; lost: number }
export class OvertakeLog { constructor(n: number); step(t: number, cars: readonly OvertakeCar[]): void; readonly events: readonly OvertakeEvent[]; summary(car: number): OvertakeSummary }
```
2. Constants: `PASS_GAP_M = 20`, `PASS_HOLD_S = 1`, `PASS_REL_V = 0.8`, `PASS_MIN_V_MS = 2`, `CONTACT_WINDOW_S = 3`.
3. Order per pair by `dist` (total race distance, strict `>`), initialised on the first `step`. A flip starts a pending pass at time `t` only if `|dist_a − dist_b| ≤ PASS_GAP_M` (else silent re-order, no event). It commits when the new order still holds at `t − flipT ≥ PASS_HOLD_S − 1e-9`; if the order reverts first, the pending pass is dropped (no event).
4. Kind is decided at commit: `gift` if the passed car is not running, its speed < `PASS_MIN_V_MS`, or its speed < `PASS_REL_V` × passer speed; else `contact` if either car's `lastContact ≥ flipT − CONTACT_WINDOW_S`; else `clean`. Event `t`, `lap`, `lapDistance`, `position` = the passer's values at commit.
5. `summary(car)`: counts of that car's events as passer by kind; `lost` = events where it is `passed`.
6. RaceGame: `readonly overtakes: OvertakeLog` (n = car count), stepped every tick after go with each car's classification distance, lap distance, `Standing.lap`, forward speed, running (`stopped`/detached-wheel cars are not running; finished cars stop being stepped — mark them not running), current position, last car-car chassis contact time (`world.contactPair` on chassis colliders, only pairs closer than 6 m, contact distance < 0.01 m). `gridPosition(car: number): number` (1-based start slot; RangeError outside 0..count−1).

## Acceptance tests (defined by the planner with Opus, before coding)
Rows AT1–AT6 use 2 cars stepped at t = k·0.1 s (k = 0…60), `lapDist = dist`, `lap 1`, `running true`, `lastContact −1e9`, `position` 1 for the car ahead, 2 behind. Car 0: dist 100 + 30t, speed 30. Car 1: dist 110 + 25t, speed 25 (car 0 ahead from t = 2.1).
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | base | step all k | one event `{passer 0, passed 1, kind 'clean', position 1, lap 1}`, t = 3.1 (1e-6), lapDistance = 193 (1e-6) |
| AT2 | base, but from t ≥ 2.6 car 1 dist = car 0 dist + 1 (car 0 ahead only 2.1–2.5 s) | step all k | no events |
| AT3 | base, car 1 lastContact = 1.5 | step all k | one event, kind 'contact' |
| AT4 | base, car 1 lastContact = −1 (3.1 s before flip at 2.1, outside window) | step all k | kind 'clean' |
| AT5 | base, car 1 speed 20 (< 0.8·30) / car 1 running false / car 1 speed 1.5 | step all k | kind 'gift' / 'gift' / 'gift' |
| AT6 | base | after all steps | `summary(0)` = {clean 1, contact 0, gift 0, lost 0}; `summary(1)` = {clean 0, contact 0, gift 0, lost 1} |
| AT7 | base, but car 0 dist = 140 + 25t for t ≥ 1 (jumps 30 m ahead of car 1) | step all k | no events (gap > 20 m at flip) |
| AT8 | Monza, f4, 3 AI, medium, seed 1, default grid, player idle; `debugStopCar(1)` 5 s after go | `gridPosition(0..3)`; step 60 s after go | 4, 1, 2, 3; ≥ 2 events with `passed 1`, all kind 'gift', passers ⊂ {2, 3}; for cars 2 and 3 the last event between them and car 1 has `passed 1`; event `t` non-decreasing (prototype with 289: car 3 passes at ~7 s and ~14 s, car 2 at ~9 s) |

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/290- tests/unit/acceptance/130- tests/unit/edge/130- tests/unit/edge/093-
```

## Out of scope
- UI (task 291), penalties, trainer scripts, replays/cameras.

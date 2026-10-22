# 312 — Race: black-flagged cars are disqualified and leave the track

Status: pending
Phase: 2
Depends on: 311, 304, 305, 306, 309
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

In races a car whose penalty outcome is `'black-flag'` is disqualified: it is classified last, frozen, collision-free and ignored by all rule logic.

## Context

- 311 adds `PenaltyOutcome` (`'ok' | 'final-warning' | 'black-flag'`), `PenaltyBook.add(...)` returning it, `PenaltyBook.isBlackFlagged`, `Classification.disqualify(car)` / `isDisqualified(car)`. 304 adds `setPlayerAutopilot(on)` and `isRetired`. 305 adds `giveBack`; 309 adds the flag countdown.
- Existing code in `src/game/raceGame.ts`: `book()` (~1083), `bookStrike`, `debugForceTrackLimits(car, count)` (~841), `debugStopCar`, arrays `stopped[]` / `finished[]` (set in `applyRules`), `vehicles[i].body` (Rapier rigid body), `flagCars[i].retired`, `yellowOut`.
- Getters for the acceptance worker: car world position = `g.getStates(out: VehicleState[])` then `out[i].position` (`{x,y,z}`, same state used for AI rendering; `out` needs `carCount` entries). Yellow state = `g.flags.sectorFlag(s)` for s = 1..3 (`'green' | 'yellow' | 'double-yellow'`, public `flags: FlagState`).

## Files

- `src/game/raceGame.ts` — modify; the `PenaltyBook` constructor drops the Infinity limits added by 311 (use `DEFAULT_PENALTY_LIMITS`).
- Planner-authorised test edit: `tests/unit/edge/130-penalty-book-and-rules-wiring.post.test.ts` POST5 uses `debugForceTrackLimits(1, 5)`, expects kinds 3 × `'warning'` + 2 × `'penalty'`, and totals 10 (book and standings). No other test edits.
- `tests/unit/acceptance/312-black-flag-race.test.ts` — create (acceptance worker).

## Steps

```ts
isDisqualified(car: number): boolean // RangeError if not an integer in [0, carCount)
```

1. `book()` uses the `PenaltyOutcome` of `penalties.add`. It still calls `classification.addPenalty` only for kind `'penalty'` when the outcome is `'ok'` or `'final-warning'`.
2. Offences of a car that has finished or is disqualified are ignored before `penalties.add` (nothing booked, no entry).
3. On `'black-flag'`: `classification.disqualify(car)`; mark the car disqualified; `vehicles[car].body.setEnabled(false)` (no collisions, pose frozen). Do it once per car.
4. A disqualified car: AI control and player input no longer affect it (skip its vehicle step like `stopped[]`; car 0 `step(input)` ignores input); excluded from track limits, VSC delta/stopped-time, overtake log, yellow overtake and give-back checks; treated as finished/out in flag logic (`flagCars[i].retired`, `yellowOut`) so it never raises or holds a yellow.
5. Car 0 disqualified: same rules; `raceFinished` keeps returning `classification.finished`.
6. `book()` may be invoked from `debugForceTrackLimits` outside a tick: handle disqualification immediately there, not deferred.

Conventions: out-of-range car throws `RangeError`; no per-tick allocations.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `RaceGame` cleveland, f4, aiCount 3, laps 3, expert, seed 1, stepped to 10 s after go | `debugForceTrackLimits(2, 6)` | `isDisqualified(2)` false; `penalties.total(2)` = 15 |
| AT2 | after AT1 | `debugForceTrackLimits(2, 1)` | `isDisqualified(2)` true; last row of `classification.standings()` is car 2; `penalties.total(2)` = 15 |
| AT3 | after AT2 | step 5 s | car 2 world position (state used for AI rendering) moves < 0.01 m; cars 1 and 3 keep moving > 50 m |
| AT4 | as AT1 | `debugForceTrackLimits(0, 7)`, step 10 s with input throttle 1 | `isDisqualified(0)` true; car 0 moves < 0.01 m; `raceFinished` false |
| AT5 | as AT1 with laps 1, `debugForceTrackLimits(3, 7)` at 10 s, `setPlayerAutopilot(true)` | step until `raceFinished` (cap 500 s sim) | `raceFinished` true; cars 0-2 finished; car 3 last |
| AT6 | laps 1, autopilot, step until car 0 finished | `debugForceTrackLimits(0, 7)` | `penalties.forCar(0).length` unchanged; `isDisqualified(0)` false |
| AT7 | as AT2 (car 2 disqualified, seed 1) | step 15 s, checking every tick | `flags.isIncidentCar(2)` false at every tick (a disqualified, stopped car is never a yellow cause; yellows from other cars are allowed) |
| AT8 | any RaceGame | `isDisqualified(4)` with aiCount 3 | `RangeError` |

## Acceptance criteria

- [ ] AT1–AT8 pass; 127, 130, 290 acceptance tests still pass.
- [ ] `npm test` passes, including protected tests 093, 130, 261, 289, 290, 294 (acceptance, edge, post) and e2e 093/130/294 unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- UI, rendering visibility, `main.ts`, qualifying, rejoin, changing `src/race/*` (311) or trackLimits.

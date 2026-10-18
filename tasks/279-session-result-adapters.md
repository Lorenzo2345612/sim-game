# 279 — Session results adapters

Status: pending
Phase: 3
Depends on: 274, 275, 277
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure functions that convert race and qualifying standings into the `SessionResult` consumed by `Weekend.submit`.

## Context

Design: `docs/design/c0-weekend.md` (279). `SessionResult` is exported by task 275 from `src/career/weekend.ts`; `Standing` from `src/race/classification.ts`; `QualiStanding` from `src/race/qualifying.ts` (task 277). Import, never redefine. Completed laps of a started car = `max(0, lap − 1)`. Guides: `ai/guides/testing.md`.

## Files

- `src/career/sessionResult.ts` — create.
- `tests/unit/acceptance/279-session-result-adapters.test.ts` — create (acceptance worker).

## Steps

```ts
import type { SessionResult } from './weekend';
import type { Standing } from '../race/classification';
import type { QualiStanding } from '../race/qualifying';
export function raceSessionResult(st: readonly Standing[], laps: number): SessionResult;
export function qualiSessionResult(st: readonly QualiStanding[]): SessionResult;
```

1. Race: `order` = cars sorted by `position` ascending. Arrays are indexed by car index; length = `st.length` (cars are 0..n-1).
2. `classified[car]` = `finished` OR `max(0, lap − 1) ≥ ceil(0.9·laps)`. `bestLaps[car]` = `bestLap` (null kept).
3. `fastestLapCar` = classified car with minimal non-null `bestLap`; tie → better (lower) position; `null` if no classified car has a best lap.
4. Quali: `order` by `position` ascending; `bestLaps[car]` = `bestLap`; `classified` all `true`; `fastestLapCar` `null`.

Conventions: positions are unique 1-based; input arrays not mutated; empty input → empty arrays and `null`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 3 standings: car 2 finished best 61, car 0 finished best 60.5, car 1 lap 9 (laps 10) best 59 unfinished | raceSessionResult(…, 10) | order [2,0,1]; classified [true, false, true] (car 1: 8 completed < 9); fastestLapCar 0 |
| AT2 | car 1 lap 10 (9 completed) unfinished, laps 10 | — | classified true for car 1 (9 ≥ 9) |
| AT3 | nobody classified | — | fastestLapCar null |
| AT4 | quali standings positions car 1, car 0 (null best) | qualiSessionResult | order [1,0], bestLaps [null, x], classified [true,true], fastestLapCar null |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/279-session-result-adapters.test.ts`.
- [ ] `src/career/sessionResult.ts` imports no `three` and no DOM.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Points computation, grid logic, `Weekend` itself (275).
- UI and `main.ts` wiring (280).
- Applying time penalties to the order (standings order is authoritative).

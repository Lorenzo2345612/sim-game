# 275 — Weekend controller

Status: pending
Phase: 3
Depends on: 274
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure state machine for a race weekend: current session, grid for it, points per session, event totals and standings.

## Context

No `three`, no DOM. Types `SessionSpec`, `WeekendFormat`, `PointsTable` come from `src/career/types.ts`, `pointsFor` from `src/career/points.ts` (task 274). `SessionResult` is defined and exported here. Car index 0 = player. Guide: `ai/guides/testing.md`.

## Files

- `src/career/weekend.ts` — create
- `tests/unit/acceptance/275-weekend-controller.test.ts` — create (acceptance worker); edge tests by tester-pre.
- No protected tests change.

## Steps

```ts
export interface SessionResult { order: number[]; bestLaps: (number | null)[]; classified: boolean[]; fastestLapCar: number | null }
export class Weekend {
  constructor(format: WeekendFormat, carCount: number, tables: Record<string, PointsTable>);
  get index(): number; get current(): SessionSpec | null; get done(): boolean;
  gridFor(): number[];                 // car indices, pole first, for the current session
  submit(r: SessionResult): number[];  // points per car scored in this session; advances index
  totals(): number[]; standings(): number[]; result(i: number): SessionResult | undefined;
}
```

1. `order` = car indices in classification order (authoritative); `bestLaps` / `classified` indexed by car.
2. `gridFor()`: practice/qualifying, and any session when no qualifying has been submitted → `[0..n-1]`. `'qualifying'`: last qualifying `order` with timed cars (bestLap ≠ null) first in that order, untimed cars after by car index. `'reverse-top8'`: first min(8, timed count) timed cars of that qualifying order, reversed, then the remaining cars in the qualifying grid order. `'sprint-result'`: `order` of the last sprint.
3. Pole points: qualifying with `polePoints` awards it to `order[0]` if its bestLap ≠ null.
4. Sprint/race: car at position pos scores `pointsFor(tables[spec.points], pos, classified[car], car === fastestLapCar)`.
5. `standings()` = car indices by totals desc; tie → each car's finishing positions in points sessions sorted ascending, compared lexicographically (lower wins); then car index.
6. `submit` returns a new array of length n; `result(i)` = submitted result of session i (undefined if not yet). After the last session `current` null and `done` true.
7. Throws `Error`: submit when done; `order` not a permutation of 0..n-1; any array of wrong length; constructor if a `'sprint-result'` session has no earlier sprint session.

Conventions: positions 1-based; invalid input throws, never clamps; stored results are copies; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `sprint` format, 4 cars | new | index 0, current.kind practice, gridFor [0,1,2,3] |
| AT2 | after practice submit (any valid) | submit Q {order [1,3,0,2], bestLaps [92.0, 90.5, null, 91.0]} | returns [0,2,0,0]; totals [0,2,0,0]; index 2 |
| AT3 | after AT2 | gridFor (sprint) | [0,3,1,2] |
| AT4 | after AT3 | submit sprint {order [3,0,1,2], classified all true, fastestLapCar 0} | returns [7,6,5,8]; totals [7,8,5,8]; standings [3,1,0,2] |
| AT5 | after AT4 | gridFor (race) | [1,3,0,2] |
| AT6 | after AT5 | submit race {order [1,0,3,2], classified [true,true,false,true], fastestLapCar 2} | returns [18,25,0,15]; totals [25,33,5,23]; standings [1,0,3,2]; done true; current null |
| AT7 | same as AT6 but fastestLapCar 0 | submit race | car 0 scores 19, total 26 |
| AT8 | done weekend / order [0,0,1,2] / bestLaps length 3 | submit | throws |
| AT9 | format {race 3 laps standard10} 3 cars | gridFor | [0,1,2] |
| AT10 | `standard`, 3 cars, Q bestLaps all null, order [2,1,0] | race gridFor | [0,1,2] |
| AT11 | format [race grid sprint-result] | constructor | throws |

## Acceptance criteria

- [ ] All AT rows pass; no `three` import.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Reading JSON, building results from `RaceGame` (279), UI/hub (280), career/teams/names, persistence.

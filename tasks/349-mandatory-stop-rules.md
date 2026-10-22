# 349 — Mandatory stop rules

Status: pending
Phase: 7
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure rule tracker for the feeder-feature mandatory stop: what counts, who satisfied it, and the penalty for missing it.

## Context

Design: `docs/design/ow-ladder.md`. Pit stops do not exist in the game yet (M2.2 not started: no pit box service, no tyre change): this task is the rule logic only; wiring is task 351 (blocked on M2.2). Rule (PRESS/EST): not before 6 completed laps; not under VSC unless the car was already in pit entry/lane (then it does not count); at least 2 wheels changed; two different dry compounds used over the race; missing it = 30 s time penalty at the finish; waived when the race is declared wet.

## Files

- `src/race/mandatoryStop.ts` — create
- `tests/unit/acceptance/349-mandatory-stop-rules.test.ts` — create

## Steps

```ts
export interface StopRule { minLap: number; minWheels: number; requireTwoCompounds: boolean; penaltyS: number }
export const FEEDER_STOP_RULE: StopRule; // { minLap: 6, minWheels: 2, requireTwoCompounds: true, penaltyS: 30 }
export class MandatoryStop {
  constructor(rule: StopRule, carCount: number, wetDeclared?: boolean);
  startCompound(car: number, compound: string): void;
  recordStop(car: number, completedLaps: number, vscActive: boolean, inPitEntryAtVsc: boolean, wheelsChanged: number, newCompound: string): boolean;
  satisfied(car: number): boolean;
  penaltyAtFinish(car: number): number;
}
```
1. `recordStop` counts when completedLaps >= minLap, wheelsChanged >= minWheels and not (vscActive && !inPitEntryAtVsc); returns whether it counted; the new compound is always added to the used set.
2. `satisfied` = a counting stop happened and (not requireTwoCompounds or used compounds >= 2 distinct). Wet declared: always satisfied, penalty 0.
3. `penaltyAtFinish` = satisfied ? 0 : penaltyS.

Conventions: inclusive `>=` on laps and wheels; unknown car index throws RangeError; compound ids are opaque strings.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/349-mandatory-stop-rules.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | rule default, start soft | recordStop(0, 6, false, false, 4, 'medium') | true; satisfied(0) true; penalty 0 |
| AT2 | same | recordStop(0, 5, ...) | false; satisfied false; penaltyAtFinish 30 |
| AT3 | same | recordStop(0, 8, true, false, 4, 'medium') / with inPitEntryAtVsc true | false (VSC) / true |
| AT4 | same | recordStop(0, 8, false, false, 1, 'medium') | false (1 wheel) |
| AT5 | start soft | recordStop(0, 8, false, false, 4, 'soft') | counted true but satisfied false (one compound); penalty 30 |
| AT6 | wetDeclared true | no stop | satisfied true, penalty 0 |
| AT7 | 2 cars | stop only car 1 | satisfied(0) false, satisfied(1) true; independent |
| AT8 | car index 9 of 2 | any method | throws RangeError |

## Acceptance criteria

- [ ] All ATs pass; no `three`, no DOM.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Pit-lane model, tyre change, penalties booking, HUD (351 after M2.2); sprint race (no mandatory stop); damage stops.

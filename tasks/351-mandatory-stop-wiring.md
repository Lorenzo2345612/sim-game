# 351 — Mandatory stop wiring (blocked on M2.2)

Status: blocked
Phase: 7
Depends on: 349 (and M2.2 pit-box service, no task numbers yet)
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

RaceGame feeds the mandatory-stop tracker from the pit stop service, books the 30 s penalty at the finish and shows a HUD flag.

## Context

Design: `docs/design/ow-ladder.md`. BLOCKED until M2.2 delivers pit-box service (tyre change, pit-lane entry/exit events, `wheelsChanged`, `newCompound`); there is no pit-stop code today. Planner decision: stays out of tasks.json and milestones until M2.2 pit stops exist; Opus planner schedules it after M2.2. Rewrite this spec against the real M2.2 API when it exists.

## Files

- `src/game/raceGame.ts` — modify
- `src/ui/hudStop.ts` — create (small HUD element, name provisional)
- tests TBD

## Steps

1. Create `MandatoryStop` only for race sessions whose format flags a mandatory stop (feature race of `ow2-weekend`; a new session flag `mandatoryStop` is added to the weekend format parser in this task).
2. On each pit stop completed, call `recordStop`; at the finish `book(car, 'penalty', penaltyAtFinish, 'missed mandatory stop')`.
3. HUD shows `STOP REQUIRED` until satisfied.

Conventions: details fixed after M2.2.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/351-mandatory-stop-wiring.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 (draft) | to be written after M2.2 | - | - |

## Acceptance criteria

- [ ] Defined after M2.2.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Everything not listed; pit strategy for AI (M2.2).

# 348 — Feeder points tables and weekend formats

Status: pending
Phase: 7
Depends on: 347
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Data for the OW-3 and OW-2 weekends: points tables and formats with reverse-grid sprint.

## Context

Design: `docs/design/ow-ladder.md`. Files `public/career/points.json`, `public/career/formats.json` (parsers in `src/career/points.ts`). Existing ids stay untouched. Planner defaults: sprint 8 laps, feature 12 laps; single qualifying session (no group split). Sources: points per research 1.3/2.2 (PRESS).

## Files

- `public/career/points.json` — modify: add tables
- `public/career/formats.json` — modify: add formats
- `tests/unit/acceptance/348-feeder-formats-data.test.ts` — create

## Steps

1. Tables: `f3-sprint` positions [10,9,8,7,6,5,4,3,2,1]; `f2-sprint` [10,8,6,5,4,3,2,1]; `feeder-feature` [25,18,15,12,10,8,6,4,2,1] with fastestLap {points 1, maxPosition 10}. Sprint tables carry fastestLap {1, 10} too (FL +1 in every race, top 10).
2. Formats: `ow3-weekend` = practice 20 min; qualifying 15 min polePoints 2; sprint 8 laps `f3-sprint` grid `reverse-top12`; race 12 laps `feeder-feature` grid `qualifying`. `ow2-weekend` = same with sprint `f2-sprint` `reverse-top10`.

Conventions: existing parser rules apply; ids unique.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/348-feeder-formats-data.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | points.json | parse all | tables f3-sprint, f2-sprint, feeder-feature exist with the positions above; old tables unchanged |
| AT2 | f2-sprint | pointsFor P1 / P8 / P9 / P8 with FL (classified) | 10 / 1 / 0 / 2 |
| AT3 | formats.json | parse | `ow3-weekend` and `ow2-weekend` session kinds [practice, qualifying, sprint, race]; sprint grid reverse-top12 / reverse-top10; qualifying polePoints 2 |

## Acceptance criteria

- [ ] All ATs pass; existing tables/formats unchanged; 274/275 and 347 suites green.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run tests/unit/acceptance/348- tests/unit/acceptance/347- tests/unit/acceptance/274- tests/unit/acceptance/275-
```

## Out of scope

- Series files (350); time-based sessions; split qualifying.

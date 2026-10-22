# 347 — Reverse-top10 and reverse-top12 grid rules

Status: pending
Phase: 7
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Weekend formats can reverse the top 10 or top 12 qualifiers for the sprint grid.

## Context

Design: `docs/design/ow-ladder.md`. `GridRule` in `src/career/types.ts`; `Weekend.gridFor` in `src/career/weekend.ts` hard-codes 8 for `reverse-top8`; `parseWeekendFormat` (in `src/career/points.ts`) validates the rule. Existing `reverse-top8` behaviour and tests (274, 275) must not change.

## Files

- `src/career/types.ts` — modify: `GridRule` adds `'reverse-top10' | 'reverse-top12'`
- `src/career/weekend.ts` — modify: N = 8/10/12 from the rule name
- `src/career/points.ts` — modify: parser accepts the new rules
- `tests/unit/acceptance/347-reverse-top-n-grid.test.ts` — create

## Steps

1. Same algorithm as `reverse-top8` with N = min(rule N, timed cars); the rest keep qualifying order.
2. Unknown rule strings still throw `Invalid weekend format`.

Conventions: N from a lookup table (no string slicing); no mutation.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/347-reverse-top-n-grid.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | 14 cars, qualifying order 0..13 all timed, sprint grid `reverse-top10` | gridFor | [9,8,7,6,5,4,3,2,1,0,10,11,12,13] |
| AT2 | same, `reverse-top12` | gridFor | [11..0 descending, 12, 13] |
| AT3 | 14 cars, only 6 timed, `reverse-top10` | gridFor | first six timed reversed, rest in qualifying order |
| AT5 | format JSON with grid `reverse-top9` | parse | throws `Invalid weekend format` |

## Acceptance criteria

- [ ] All ATs pass; 274/275 tests unchanged and green.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run tests/unit/acceptance/347- tests/unit/acceptance/274- tests/unit/acceptance/275-
```

## Out of scope

- Points tables and format data (348); split qualifying; group-based reverse grids.

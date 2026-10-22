# 350 — OW ladder series data

Status: pending
Phase: 7
Depends on: 324, 344, 345, 348
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Two fictional career series, OW-3 and OW-2, as data for the C1/C3 career.

## Context

Design: `docs/design/ow-ladder.md`. Parser and shape from task 324 (`parseSeries`, `SeriesDef`), grid nationality mix in `public/career/grids.json` (`series.<id>.mix`). Fictional, brand-neutral names; never F1/F2/F3/FIA/Tatuus names. The series names `Feeder 3 Cup` and `Feeder 2 Series` are approved by the planner.

## Files

- `public/career/series/ow3-cup.json`, `public/career/series/ow2-cup.json` — create
- `public/career/grids.json` — modify: add `series` entries `ow3-cup` and `ow2-cup` (mix sums to 1)
- `tests/unit/acceptance/350-ow-ladder-series-data.test.ts` — create

## Steps

1. `ow3-cup`: name `Feeder 3 Cup`, carId `ow3`, gridsSeries `ow3-cup`, formats [`ow3-weekend`], 5 fictional teams, perf 1.0, 0.995, 0.99, 0.985, 0.98; calendar 6 existing tracks `monza`, `spa`, `silverstone`, `spielberg`, `budapest`, `bahrain`.
2. `ow2-cup`: name `Feeder 2 Series`, carId `ow2`, gridsSeries `ow2-cup`, formats [`ow2-weekend`], 6 teams, perf 1.0 .. 0.975, calendar `bahrain`, `lusail`, `monza`, `spa`, `silverstone`, `baku`.
3. Distinct `#rrggbb` team colours; no occurrence of forbidden brand names.
4. `grids.json` mixes: European-weighted (as `f4-europe`) for ow3, wider international for ow2.

Conventions: JSON data only; the event names are fictional (no real GP names).

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/350-ow-ladder-series-data.test.ts`. Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | both series files, track ids from `public/tracks/index.json`, format ids from formats.json | parseSeries (324) | parse OK; teams 5 / 6; carId ow3 / ow2; formats as above |
| AT2 | grids.json | read | entries `ow3-cup`, `ow2-cup` exist, mix values sum to 1 (1e-6) |
| AT3 | both series files + grids | case-sensitive whole-word search | none of `F1`, `F2`, `F3`, `FIA`, `Formula`, `Tatuus`, `Dallara` |
| AT4 | carIds | lookup in `public/cars/index.json` | both present |

## Acceptance criteria

- [ ] All ATs pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Career season UI changes, ladder promotion rules (C3), AI progression.

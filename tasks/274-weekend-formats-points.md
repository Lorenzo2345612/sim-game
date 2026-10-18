# 274 — Weekend formats and points tables

Status: pending
Phase: 3
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure parsers and data for race-weekend formats and points tables, plus the `pointsFor` scoring function. First of the C0 weekend tasks (design: `docs/design/c0-weekend.md`).

## Context

No `three`, no DOM. `src/career/` does not exist yet. Error style: `throw new Error('...')` as in `src/track/parseTrackData.ts`. JSON is fetched from `public/career/` at runtime by later tasks; this task only provides parsers and files. Guide: `ai/guides/testing.md`.

## Files

- `src/career/types.ts` — create — the types below
- `src/career/points.ts` — create — the three functions below
- `public/career/points.json` — create — `{ "tables": [PointsTable, ...] }`
- `public/career/formats.json` — create — `{ "formats": [WeekendFormat, ...] }`
- `tests/unit/acceptance/274-weekend-formats-points.test.ts` — create (acceptance worker)
- No protected tests change.

## Steps

```ts
// src/career/types.ts
export type SessionKind = 'practice' | 'qualifying' | 'sprint' | 'race';
export type GridRule = 'qualifying' | 'reverse-top8' | 'sprint-result';
export interface SessionSpec { kind: SessionKind; minutes?: number; laps?: number; points?: string; grid?: GridRule; polePoints?: number }
export interface WeekendFormat { id: string; name: string; sessions: SessionSpec[] }
export interface PointsTable { id: string; positions: number[]; fastestLap?: { points: number; maxPosition: number } }
// src/career/points.ts (import types from './types')
export function parsePointsTable(json: unknown): PointsTable;
export function parseWeekendFormat(json: unknown, tables: Record<string, PointsTable>): WeekendFormat;
export function pointsFor(table: PointsTable, position: number, classified: boolean, fastestLap: boolean): number; // position 1-based
```

1. `parseWeekendFormat` rules: non-empty `sessions`; known kind; practice/qualifying need `minutes` > 0 and no `laps`; sprint/race need integer `laps` ≥ 1 and a `points` id present in `tables`; `grid` defaults to `'qualifying'` for sprint/race; `polePoints` (number ≥ 0) only allowed on qualifying. Returns a new normalised object.
2. `parsePointsTable` rules: `id` non-empty string; `positions` non-empty array of finite numbers ≥ 0, non-increasing; `fastestLap` optional with `points` ≥ 0 and integer `maxPosition` ≥ 1.
3. `pointsFor`: `positions[position-1]` or 0 beyond the list; plus `fastestLap.points` if `fastestLap` flag, `position <= maxPosition` and table has the rule. Unclassified → 0 always.
4. Errors: `Error('Invalid weekend format: <field>')` and `Error('Invalid points table: <field>')` (field = offending key name).
5. Data: `standard10` = positions [25,18,15,12,10,8,6,4,2,1], fastestLap {points 1, maxPosition 10}; `sprint8` = [8,7,6,5,4,3,2,1]. Formats (ids `short`,`standard`,`sprint`; names "Short", "Standard", "Sprint"): `short` = qualifying 10 min; race 5 laps standard10. `standard` = practice 20 min; qualifying 15; race 10 laps standard10. `sprint` = practice 20; qualifying 15 polePoints 2; sprint 6 laps sprint8 grid reverse-top8; race 10 laps standard10 grid qualifying.

Conventions: position < 1 or non-integer → 0 points; invalid JSON shape throws; inputs not mutated; no rounding.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | standard10 | pointsFor P1 / P10 / P11, classified, no FL | 25 / 1 / 0 |
| AT2 | standard10 | P3+FL, P1+FL, P11+FL (classified) | 16, 26, 0 |
| AT3 | standard10 | P5 unclassified with FL | 0 |
| AT4 | sprint8 | P8, P9 with FL true | 1, 0 (no FL rule) |
| AT5 | `public/career/points.json`, `formats.json` | parse all | tables standard10, sprint8; formats short, standard, sprint with session kinds exactly as listed above |
| AT6 | format JSON variants | sessions [] / kind 'warmup' / race points 'nope' / qualifying with laps 5 / race without laps / polePoints on race | each throws an Error whose message starts `Invalid weekend format` |
| AT7 | points JSON | positions [10, 12] / [5, -1] / missing id | throws `Invalid points table` |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/274-weekend-formats-points.test.ts`.
- [ ] `public/career/*.json` parse with the parsers; no `three` import in `src/career`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Weekend state machine (275), session result adapters (279), UI, loading JSON over fetch.

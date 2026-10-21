# 324 — Series data and parser

Status: pending
Phase: 3
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A fictional series ("Latin F4 Cup") described in JSON and a validating parser, base of the C1 season (milestone M3.2).

## Context

No `three`, no DOM. Design: `docs/design/c1-season.md`. Format and track ids come from `public/career/formats.json` and `public/tracks/index.json` (passed in as arrays; the parser does no I/O). Follow the style of `src/career/points.ts` parsers. Names must be fictional and brand-neutral: no F1/FIA/real-team names, never "Tatuus".

## Files

- `src/career/series.ts` — create
- `public/career/series/f4-latam.json` — create
- `tests/unit/acceptance/324-series-data.test.ts` — create (acceptance worker)

## Steps

```ts
export interface TeamDef { id: string; name: string; colour: string; perf: number }
export interface EventDef { trackId: string; name: string }
export interface SeriesDef { id: string; name: string; carId: string; gridsSeries: string; formats: string[]; teams: TeamDef[]; calendar: EventDef[] }
export function parseSeries(json: unknown, trackIds: readonly string[], formatIds: readonly string[]): SeriesDef;
```

1. Validation (any failure throws `Error('Invalid series: <field>')`): `id`, `name`, `carId`, `gridsSeries` non-empty strings; ≥ 2 teams, team ids unique and non-empty, team `name` non-empty, `perf` finite in [0.9, 1.0], `colour` matches `#rrggbb` (hex digits, either case); calendar 1–12 events, each `trackId` in `trackIds`, `name` non-empty; `formats` non-empty, each in `formatIds`. Non-object input throws too.
2. Data file `f4-latam.json` (JSON shape = `SeriesDef`): id `f4-latam`, name `Latin F4 Cup`, carId `f4`, gridsSeries `f4-latam`, formats `short`, `standard`, `sprint`.
3. Six teams in this order with perf 1.00, 0.995, 0.99, 0.985, 0.98, 0.975: ids/names fictional and distinct (e.g. `aurora` Aurora Motorsport, `condor` Condor Racing, `jaguar-sur` Jaguar Sur, `volcan` Volcan Team, `marea` Marea GP, `selva` Selva Racing), each with a distinct `#rrggbb` colour.
4. Calendar, in order, trackIds: `mexico`, `braselton`, `ermita-federal`, `elkhart`, `cleveland`, `ermita-centro` (finale). Event names fictional (e.g. "Altiplano Cup", "Peachtree Round"), no real GP names.

Conventions: invalid input throws, never clamps; input not mutated; output is a fresh copy.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/career/series/f4-latam.json`, ids from `public/tracks/index.json`, formats from `formats.json` | parse | 6 teams with perf [1, 0.995, 0.99, 0.985, 0.98, 0.975]; calendar trackIds exactly [mexico, braselton, ermita-federal, elkhart, cleveland, ermita-centro]; formats [short, standard, sprint]; carId f4 |
| AT2 | f4-latam variants | 1 team / duplicate team id / perf 1.01 / colour `red` / trackId `nowhere` / 0 events / 13 events / format `endurance` / formats [] | each throws, message starts `Invalid series` |

## Acceptance criteria

- [ ] All AT rows pass; no `three` import.
- [ ] `f4-latam.json` contains no occurrence of "Tatuus", "FIA", "Formula 1".

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Season state (325), loading via fetch, UI, liveries, other series files.

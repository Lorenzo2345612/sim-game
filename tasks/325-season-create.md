# 325 — Season creation, AI pace, event seed

Status: pending
Phase: 3
Depends on: 324
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure creation of a season state (12 drivers on 6 teams), per-car AI pace multipliers and a deterministic per-event seed.

## Context

No `three`, no DOM. Design: `docs/design/c1-season.md`. Types: `SeriesDef` from `src/career/series.ts` (324), `SessionResult` from `src/career/weekend.ts`, `Driver` from `src/race/drivers.ts`, `Difficulty` from `src/ai/traffic.ts`. Car index = driver index: car 0 = player.

## Files

- `src/career/season.ts` — create
- `src/race/drivers.ts` — modify only to add `export` to the existing `mulberry32` (no other change)
- `tests/unit/acceptance/325-season-create.test.ts` — create (acceptance worker)

## Steps

```ts
export interface SeasonDriver extends Driver { teamId: string; skill: number; isPlayer: boolean }
export interface EventRecord { round: number; sessions: SessionResult[]; points: number[] }
export interface SeasonState { version: 1; seriesId: string; formatId: string; difficulty: Difficulty; seed: number; year: number; drivers: SeasonDriver[]; events: EventRecord[]; pending: SessionResult[] }
export interface PlayerInfo { first: string; last: string; nat: string; number: number }
export function createSeason(series: SeriesDef, opts: { formatId: string; difficulty: Difficulty; seed: number; year: number; player: PlayerInfo }, ai: readonly Driver[]): SeasonState;
export function aiPace(state: SeasonState, series: SeriesDef): number[];
export function eventSeed(state: SeasonState, round: number): number;
```

1. `createSeason` throws `Error('Invalid season: <field>')` when `ai.length !== 2·teams − 1` or `formatId` not in `series.formats`.
2. `drivers[0]` = player: team = last team, `skill` 1, `isPlayer` true, `code` = first 3 letters of `last` upper-case, other fields from `PlayerInfo`. `drivers[k]` (k ≥ 1) = copy of `ai[k−1]` with `isPlayer` false, team index `floor((k−1)/2)`.
3. AI `skill` = 0.985 + 0.015·u, u = k-th draw (k = 1..11) of `mulberry32(seed)`.
4. `events` and `pending` start as empty arrays; `version` 1.
5. `aiPace[k]` = team perf × skill of driver k (team looked up by `teamId` in `series.teams`); `[0]` = 1; length = drivers.length.
6. `eventSeed` = FNV-1a 32-bit (unsigned) over the UTF-8 bytes of `${seed}|${year}|${seriesId}|${round}`.

Conventions: results unsigned 32-bit for the hash; invalid input throws; inputs not mutated; state holds copies.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | f4-latam, 11 AI drivers, seed 7, year 2027, format short | createSeason | 12 drivers; drivers[0] isPlayer, team = 6th team id, skill 1; drivers[1], [2] on the first team, drivers[11] on the 6th; drivers[k] names = ai[k−1] |
| AT2 | AT1 | aiPace | length 12; [0] = 1; every [k] in [team perf × 0.985, team perf] (1e-12); same seed → identical array; seed 8 → differs |
| AT3 | AT1 | eventSeed round 0 / 1 / 5 | 2835877001 / 2819099382 / 2886209858 |
| AT4 | 10 AI drivers / format `endurance` | createSeason | throws `Invalid season` |

## Acceptance criteria

- [ ] All AT rows pass; no `three` import; existing tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Standings and session submission (326), save codec (327), UI, generating the AI grid.

# 327 — Season save codec and stores

Status: pending
Phase: 3
Depends on: 325
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Serialise/validate a season state to text and persist it through a `SaveStore` (in-memory for tests, IndexedDB for the browser).

## Context

Design: `docs/design/c1-season.md`. Types `SeasonState` (325), `SeriesDef` (324). Codec has no DOM; `IdbStore` uses the browser `indexedDB` global and is exercised only by the 330 e2e (no IndexedDB in Vitest: do not unit-test it, do not add a fake-indexeddb dependency).

## Files

- `src/career/save.ts` — create
- `tests/unit/acceptance/327-season-save.test.ts` — create (acceptance worker); the 326 AT3 state is written as a literal object in the test (no import of `seasonControl.ts`, so 327 stays independent of 326).

## Steps

```ts
export const SAVE_VERSION = 1;
export function serializeSeason(s: SeasonState): string;
export function parseSeason(text: string, series: SeriesDef): SeasonState;
export interface SaveStore { load(): Promise<string | null>; save(text: string): Promise<void>; clear(): Promise<void> }
export class MemoryStore implements SaveStore {}
export class IdbStore implements SaveStore { constructor(dbName?: string) }
```

1. `serializeSeason` = `JSON.stringify` of the state (no extra fields).
2. `parseSeason` throws `Error('Invalid save: <field>')` on: unparsable JSON, `version` ≠ 1, `seriesId` ≠ `series.id`, `formatId` not in `series.formats`, `drivers.length` ≠ 2 × teams, a `teamId` not in `series.teams`, `isPlayer` not true on exactly `drivers[0]`, `events.length` > calendar length, `events[i].round` ≠ i, any `points` array or any session array (`order`, `bestLaps`, `classified`) of length ≠ drivers.length (in events and in `pending`). Returns a plain `SeasonState`.
3. `MemoryStore`: holds one string; `load` returns null when empty; `clear` empties.
4. `IdbStore`: default db name `simgame`, object store `career`, key `season`. `save` copies the previous value to key `season-backup` in the same transaction before writing. `load` returns null when absent; `clear` deletes `season` only.

Conventions: invalid input throws, never repairs; parse returns fresh objects.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 326 AT3 state | parseSeason(serializeSeason(s)) | deep-equals s |
| AT2 | serialized AT1 with: `{` / version 2 / seriesId `x` / 3 drivers / drivers[1].isPlayer true / events[0].round 1 / events[0].points length 3 | parseSeason | each throws, message starts `Invalid save` |
| AT3 | MemoryStore | load / save('a') then load / clear then load | null / 'a' / null |

## Acceptance criteria

- [ ] All AT rows pass; `npm run typecheck` passes with `IdbStore` using only DOM lib types.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- UI, autosave wiring (330), export/import files, multiple save slots, save migration.

# 276 — RaceGame grid order

Status: pending
Phase: 3
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`RaceConfig.gridOrder` lets the caller choose which car starts at each grid position, so qualifying results can set the grid.

## Context

Today (`src/game/raceGame.ts`, `RaceGame.create`): `const grid = gridSlots(track, count)` then `slot = i === 0 ? grid[aiCount] : grid[i - 1]` (player last, AI k = car k+1 at slot k). Car index 0 = player, k+1 = AI k. `aiCount` is already clamped to 0..15 and `count = aiCount + 1`; validate against `count`.

## Files

- `src/game/raceGame.ts` — modify — add field to `RaceConfig`, use it in `create`
- `tests/unit/acceptance/276-race-grid-order.test.ts` — create (acceptance worker)
- Protected tests that must stay green unchanged: `tests/unit/acceptance/091-start-and-grid.test.ts`, `093-race-game.test.ts`.

## Steps

```ts
export interface RaceConfig { /* existing fields */ gridOrder?: number[] } // gridOrder[p] = car index at grid position p
```

1. Absent → current behaviour exactly.
2. Present → car `gridOrder[p]` spawns at `gridSlots(track, count)[p]`.
3. Invalid (length ≠ `count`, duplicate, non-integer, outside 0..count-1) → `create` rejects (async rejection) with `Error` whose message contains `gridOrder`, before creating physics bodies where practical (validate before `createPhysicsWorld`).

Conventions: validation strict, no clamping; `gridOrder` not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 3, gridOrder [2,0,3,1], seed 1 | create, getStates (no step) | car 2 at slot 0, car 0 slot 1, car 3 slot 2, car 1 slot 3 (x,z within 0.05 m of `gridSlots(track,4)[p].position`) |
| AT2 | monza, aiCount 3, no gridOrder | create | car 0 at slot 3, car k+1 at slot k (0.05 m) |
| AT3 | gridOrder [0,1,2] / [0,0,1,2] / [0,1,2,4] with aiCount 3 | create | rejects, message contains `gridOrder` |

## Acceptance criteria

- [ ] All AT rows pass; 091 and 093 tests unchanged and green.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Timed sessions (278), start-light changes, weekend logic, UI.

# 153 — Simulation cost with 16 cars

Status: pending
Phase: 3
Depends on: 151
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A 16-car race tick is cheap and allocation-free, with identical (deterministic) results.

## Context

M5, design `docs/plans/late-features.md` ("153"). Read the current code first: this task runs after 151 and the whole race stack (`src/game/raceGame.ts` 093, `AiDriver`/traffic 089–090, damage/debris 145–147, `src/track/trackProgress.ts`, `src/physics/physicsWorld.ts`); adapt file names to what exists, keep the public contract. `TrackProgress.update(x, z)` exists today (global search). Rapier `world.integrationParameters.numSolverIterations`. Never trade away determinism (093 AT4). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/track/trackProgress.ts` — modify: windowed search.
- `src/game/raceGame.ts` — modify: allocation-free tick, solver iterations, contact-event filtering.
- `src/physics/physicsWorld.ts` — modify only if the iteration setting lives there.
- `tests/unit/acceptance/153-simulation-cost.test.ts` — create (acceptance worker).

## Steps

1. `TrackProgress.update(x, z)` returns identical results to today for on-track motion but searches only ±100 samples around the previous index; full search on the first call, after `reset()`, or when the best windowed distance > 25 m.
2. `RaceGame.step`, `AiDriver`, traffic, classification: no per-tick allocations (preallocated observation/decision/state objects, arrays reused, no `map`/`filter`/spread in the tick).
3. `world.integrationParameters.numSolverIterations = 4` if AT3 and the 066/070 handling tests still pass; otherwise keep the default and report it.
4. Contact force events are enabled on chassis colliders only (no events from track/kerb/debris-vs-track colliders).
5. Results (positions after N ticks) must be bit-identical for the same seed before/after steps 1, 2 and 4.

Conventions: milliseconds per tick = wall time / ticks using `performance.now()`; the "single-car tick" is a `RaceGame` with `aiCount` 0 on the same track; heap measured with `process.memoryUsage().heapUsed`, calling `globalThis.gc?.()` before each reading; warm-up 120 ticks.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node monza race, 15 AI, 600 ticks | wall time | ≤ 2.0 ms per tick (mean) on the dev machine; ≤ 1.6× the single-car tick |
| AT2 | same, after warm-up | heap growth over 600 ticks | < 1 MB |
| AT3 | 093 AT4 determinism | rerun | still identical |

## Acceptance criteria

- [ ] AT1–AT3 pass; 087–093 and 145–147 tests still pass.
- [ ] A profile note (one line per change with measured ms/tick before and after) is added to the task's report, not to the repo docs.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Web workers, WASM threading, changing the vehicle model or AI behaviour; render optimisation (152).
- README, tasks.json, milestones.json.

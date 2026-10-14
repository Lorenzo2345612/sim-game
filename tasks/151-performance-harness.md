# 151 — Performance harness and budgets

Status: pending
Phase: 3
Depends on: 093
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The game exposes frame/sim/render timing statistics and a script runs fixed scenarios and writes them to JSON, checked against budgets.

## Context

M5, design `docs/plans/late-features.md` ("151"). Read the current code first: this task runs after 093 (`src/main.ts`, `RaceGame`, `?race=1&track=spa&ai=15`); adapt file names to what exists, keep the public contract. Existing hooks: `__SIMGAME__.drawCalls()`, `sceneStats()`; `renderer.info.render` gives calls/triangles, `renderer.info.memory` gives textures/geometries. Scripts use Playwright (in the stack). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e: `tests/e2e/acceptance/151-perf-harness.spec.ts`.

## Files

- `src/core/perfStats.ts` — create (pure).
- `src/main.ts` — modify: record `frameMs`, `simMs`, `renderMs` per frame with `performance.now()`; add `__SIMGAME__.perfStats()`.
- `scripts/perf/bench.mjs`, `scripts/perf/budgets.json` — create.
- `tests/unit/acceptance/151-perf-harness.test.ts`, `tests/e2e/acceptance/151-perf-harness.spec.ts` — create (acceptance worker).

## Steps

```ts
export interface Percentiles { p50: number; p95: number }
export class FrameRing { constructor(capacity?: number /* default 300 */); push(ms: number): void; readonly length: number; percentiles(): Percentiles }
export interface PerfStats { fps: number; frameMs: Percentiles; simMs: Percentiles; renderMs: Percentiles; drawCalls: number; triangles: number; textures: number; geometries: number }
```

1. `FrameRing`: preallocated `Float64Array`, `push` never allocates; `percentiles()` sorts a preallocated scratch copy, linear interpolation between ranks (position `p·(n−1)`); empty ring → `{p50: 0, p95: 0}`; non-finite values ignored on push.
2. `perfStats()`: percentiles over the last 300 frames; `fps = 1000 / frameMs.p50` (0 if p50 is 0); counters from the last rendered frame.
3. `bench.mjs <url> <out.json> [--gpu] [--check]`: launches Chromium (software GL unless `--gpu`), runs scenarios, 2 s warm-up discarded, writes `{ [scenarioKey]: PerfStats }`. Scenarios: `monza-chase` `/?track=monza` 10 s; `spa-race16` `/?race=1&track=spa&ai=15&laps=3` 30 s; `monza-cockpit` `/?track=monza` with the cockpit camera selected through its existing key 10 s; `lusail-night` `/?track=lusail` 10 s (only if `sceneStats().timeOfDay === 'night'`); `spa-rain` `/?track=spa&rain=1` 10 s (only if `sceneStats().rainParticles` is defined). Skipped scenarios have no key.
4. `budgets.json` (medium preset, RTX-class): `{ "frameP95Ms": 16.7, "simP95Ms": 3, "drawCalls": 300, "triangles": 2500000 }`. Exit code is 0 unless `--check` is given and a scenario exceeds a budget (then 1, listing offenders). Exit 1 also on page errors or load failure.

Conventions: milliseconds; budget comparisons `>` fail; the ring keeps the latest `capacity` values.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: ring buffer with frame times 1..300 ms | percentiles | p50 150.5 ± 0.5, p95 285.5 ± 0.5 |
| AT2 | e2e `/?track=monza` 3 s | perfStats() | all fields finite; drawCalls > 0 |
| AT3 | `node scripts/perf/bench.mjs <url> out.json` (software GL allowed) | run | out.json has every scenario key with a perfStats object; exit 0 |

## Acceptance criteria

- [ ] AT1–AT3 pass; AT3 "every scenario key" = the scenarios not skipped by their guards.
- [ ] No per-frame allocation added to the main loop (reuse the ring and one output object).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 151-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Optimising anything (152–154); CI integration; GPU timer queries.
- README, tasks.json, milestones.json.

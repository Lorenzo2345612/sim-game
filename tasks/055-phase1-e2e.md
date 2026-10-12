# 055 — Phase 1 end-to-end checks on three tracks

Status: pending
Phase: 1
Depends on: 054
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Playwright checks that Monza, Spa and Silverstone load, run and render correctly, closing Phase 1.

## Context

Acceptance tests for this task are Playwright in `tests/e2e/acceptance/055-phase1-e2e.spec.ts`; the coder writes the broader `tests/e2e/phase1.spec.ts` (smoke across tracks, reuses the same helpers). Tracks are selected with `?track=<id>`; debug state via `window.__SIMGAME__` (`getSpeedKmh`, `carPosition`, `drawCalls`, `teleportToIndex`; tasks 043, 054). Existing e2e patterns: `tests/e2e/phase0.spec.ts`.

## Files

- `tests/e2e/phase1.spec.ts` — create — per track: loads without console errors; reaches speed > 50 km/h within 5 s of full throttle; screenshot taken.
- `tests/e2e/acceptance/055-phase1-e2e.spec.ts` — created by the acceptance worker from the table below.

## Steps

- Parametrise over `monza`, `spa`, `silverstone`. Each test must finish within the Playwright default timeout configured in the repo.
- Teleport and inspection use only `window.__SIMGAME__` (`teleportToIndex(i)`, `carPosition()`, `drawCalls()`); the Spa max-gradient index is computed in the test from `/tracks/spa.json` `elevation`. Do not modify `src/`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/e2e/acceptance/055-phase1-e2e.spec.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e each of monza/spa/silverstone | load and drive 5 s | ready < 20 s; no console errors; speed > 50 km/h |
| AT2 | e2e each track | screenshot at start | asphalt under car; foliage present: in the band y 200–280, x < 300, ≥ 30 % of pixels have G > R and luminance < 0.5 |
| AT3 | e2e Monza | `renderer.info.render.calls` at start | ≤ 300 |
| AT4 | e2e Spa | car reaches Eau Rouge region (teleport debug to index of max elevation gradient) | car y changes > 10 m within 300 m of driving |

## Acceptance criteria

- [ ] `npm run test:e2e` passes for all three tracks.

## Verification

```
npm run typecheck
npm run lint
npm run test:e2e
```

## Out of scope

- Changing anything in `src/`, performance tuning, visual regression baselines.


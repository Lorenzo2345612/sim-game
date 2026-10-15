# 070 — Integrate the new vehicle model in the game

Status: pending
Phase: 1
Depends on: 054, 057, 058, 065, 169, 066, 067, 068, 069
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The browser game runs the Phase 1.5 vehicle model: it loads the car file, applies the saved setup, uses a tyre compound and wear/fuel multipliers, shows the tyre/fuel HUD and exposes telemetry.

## Context

Pure wiring in `src/main.ts` / `src/game/game.ts` (see `ai/guides/architecture.md` layers; do not change module APIs of tasks 058–069). Design: `ai/guides/vehicle-dynamics.md`. Existing `window.__SIMGAME__` (task 054) is extended. Acceptance tests: Playwright in `tests/e2e/acceptance/070-dynamics-integration.spec.ts`.

## Files

- `src/main.ts` — modify — wiring, query/options, HUD mount, `__SIMGAME__`
- `src/game/game.ts` — modify — construct `Vehicle` with the applied `CarSpec`; expose telemetry, heading, per-lap fuel
- `src/core/settings.ts` — modify — options `wear` and `fuel` multipliers (default 1) and `compound` (default `'medium'`)

## Steps

1. Boot: `fetch('/cars/<id>.json')` (id from `?car=`, default `f4`) → `parseCarSpec`; spec = `applySetup(spec, loadSetup(carId, trackId, spec, localStorage))`; Game builds `Vehicle` from it. Restart (menu or setup Apply) rebuilds the Game with the freshly loaded setup.
2. Compound: `?compound=soft|medium|hard` else stored option else `medium`; invalid values fall back to `medium`.
3. Multipliers: `?wear=<n>` and `?fuel=<n>` (finite, > 0, else 1) override stored options; passed with `Vehicle.setMultipliers(wear, fuel)` and `Vehicle.setCompound(name)` (065).
4. HUD: mount `HudTyres` (task 069) each frame from telemetry (`optTempC`/`tempWindowC` from the active compound in `spec.tyres.compounds`); `meanLapL` = mean fuel burnt over completed laps, null before the first.
5. `window.__SIMGAME__` adds `telemetry(): { wheels: { fz: number; kappa: number; alpha: number; tempC: number; wear: number }[]; fuelKg: number; rpm: number; gear: number }` and `getHeading(): number` (yaw, rad). Existing members unchanged.
6. The pause-menu Setup panel wired by 068 is fed the spec from step 1 (remove 068's temporary `/cars/f4.json` fetch).

Conventions: fixed-step determinism kept (no `Math.random` or wall-clock in simulation); invalid query values never throw; telemetry numbers are finite.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=monza` | 5 s throttle | speed > 100 km/h, `telemetry().wheels` length 4 with finite values, fuel decreasing |
| AT2 | e2e: setup rear wing max vs min (via storage) | top speed after 20 s | max wing slower by > 3 km/h |
| AT3 | e2e: `?wear=5` vs `?wear=1`, same 30 s script | wear ratio | in [4, 6] |
| AT4 | e2e `/?track=monza` at > 150 km/h | full brake + full steer for 2 s of sim time | \|`getHeading()` − velocity direction\| < 30° throughout (no spin) |
| AT5 | Verification commands | run | pass (covered by Verification; no dedicated test) |
| AT6 | e2e: game running | HUD | `.tyres` has 4 boxes and `.fuel` visible inside the viewport |

## Acceptance criteria

- [ ] AT1–AT6 pass; AT4 uses `getHeading()` vs velocity direction (< 30°) as in task 066 AT5.
- [ ] No console errors during 10 s of driving; Phase 0/1 e2e tests pass (adjust only thresholds replaced by the new targets).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 070-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

New cars or tracks, pit stops, damage, tuning `f4.json` (task 066), changing physics/UI module APIs, audio changes, options UI for wear/fuel/compound.

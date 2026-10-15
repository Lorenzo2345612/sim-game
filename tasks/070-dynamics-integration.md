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
| AT2 | unit: elkhart track JSON; f4 spec through `loadSetup('f4','elkhart',spec,storage)` + `applySetup` with a fake storage holding rearWing 0, then 10 | `Game.create(track, spec)`, 1200 `step()` calls at full throttle | wing 10 forward speed lower by > 1.5 km/h (planner Game probe: 158.53 vs 156.25, delta 2.27) |
| AT3 | e2e: `?wear=5` vs `?wear=1`, same 6 s full-throttle script (car stays on the Monza straight) | wear ratio | in [4, 6] |
| AT4 | e2e `/?track=monza` at ≥ 120 km/h | full brake + full steer for 2 s of sim time | \|`getHeading()` − velocity direction\| < 30° throughout (no spin) |
| AT5 | Verification commands | run | pass (verification gate; no dedicated test) |
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

## Planner-authorised test edits

Planner ran the e2e on the coder's wiring (uncommitted in the worktree): AT1, AT2, AT6 pass; AT3 failed once with a Playwright `browser.newContext` protocol error (infra flake); AT4 timed out because with throttle only and no steering the car drifts off the Monza straight onto grass at ~7 s / ~151 km/h (planner probe; flat-ground lab: 0-100 4.0 s, 193 km/h at 16 s, so no calibration issue). The wiring in the worktree is complete: do NOT tune physics or car files, do not analyse track data, no `sleep` loops, no `pkill`.
In `tests/e2e/acceptance/070-dynamics-integration.spec.ts` change only:
- AT4: speed threshold `>= 150` → `>= 120` (test title text to match) and that `waitForFunction` timeout `180000` → `300000`.
- Add `test.describe.configure({ mode: 'serial' });` as the first line inside the `test.describe` block (serial runs; swiftshader is slow under parallel workers).
- AT3: in `meanWear`, `waitSim(page, 30, 360000)` → `waitSim(page, 6, 180000)` (title text to match). Planner lab probe: wear ratio is exactly 5.00 on flat ground at 6 s and 30 s; the 30 s e2e failure (ratio 0.08) is the car leaving the track at ~7 s and crashing, not the grip cliff.

- AT2: delete the e2e AT2 test (and `primeRearWing`/`topSpeedOverRun` if unused). Add `tests/unit/acceptance/070-wing-setup.test.ts` implementing the AT2 row (deterministic: wall-clock e2e sampling noise exceeded the 2.6 km/h effect). Use the same `loadSetup`/`applySetup` calls as the boot path in `src/main.ts`.

Then run the verification once and report.

## Out of scope

New cars or tracks, pit stops, damage, tuning `f4.json` (task 066), changing physics/UI module APIs, audio changes, options UI for wear/fuel/compound.

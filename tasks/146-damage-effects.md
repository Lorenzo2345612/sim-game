# 146 — Damage effects on the vehicle (aero, toe, grip, lost wheel)

Status: pending
Phase: 2
Depends on: 144, 070
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The vehicle model changes its behaviour according to its `DamageState`: less downforce, steering pull, less grip, and a dragging chassis when a wheel is lost.

## Context

M2.4, design `docs/plans/late-features.md` ("146"). Read the current code first: this task runs after 144 (`src/physics/damage.ts`) and 070 (`src/physics/vehicle.ts`, aero in `src/physics/aero.ts`, per-wheel solver `wheelSolver.ts`); adapt file names to what exists, keep the public contract. `Vehicle.damage` / `damageMode` are created by 145; if 145 has not run, add them here exactly as 145's spec says (`damage: DamageState`, `damageMode: DamageMode`, default `'full'`). Effects apply only when `damageMode === 'full'`. Wheel order FL, FR, RL, RR; positive steer = left. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`, `ai/guides/vehicle-dynamics.md`.

## Files

- `src/physics/vehicle.ts` — modify: read `damageEffects(this.damage)` each step; add `getDownforce(out?: { front: number; rear: number }): { front: number; rear: number }` (N, last step).
- `src/physics/aero.ts` — modify only if needed to scale front/rear downforce separately (drag unchanged).
- `tests/unit/acceptance/146-damage-effects.test.ts` — create (acceptance worker).

## Steps

1. Front/rear downforce multiplied by `aeroFront`/`aeroRear`; drag unchanged.
2. Per-wheel `toe` (rad) added to that wheel's steer angle (after the driver steer).
3. Each wheel's tyre force (longitudinal and lateral) multiplied by `gripScale[i]`.
4. Detached wheel `i`: no suspension force and no tyre force from it; wheel ray still ignored; on the transition to detached, add one sphere collider to the chassis body at the corner: sphere radius 0.12 m, centre at (hub x, hub y − wheelRadius + 0.12, hub z) in car-local, friction 0.8, no mass contribution (mass 0 / density 0). Created once per detached wheel; removed on `reset()` together with `damage` reset.
5. `damageMode !== 'full'` → all of the above skipped (state is still tracked).
6. Reuse the `DamageEffects` object each step (no allocation).

Conventions: SI units; NaN-free outputs for any `DamageState`; `reset(spawn)` clears `damage` via `createDamageState()` fields in place.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node: f4 at a constant 60 m/s on a flat plane, frontWing 1 | read front downforce | 0.3 × undamaged ± 1 % |
| AT2 | suspension[0] = 1, straight line, steer 0, 30 m/s, 3 s | yaw drift | heading changes ≥ 1° (pull); with no damage < 0.1° |
| AT3 | detached[1] | full throttle 10 s on flat | top speed < 0.6 × undamaged; no NaN; chassis min y ≥ −0.05 |
| AT4 | puncture[3] | skidpad max lateral g (066 setup) | < 0.85 × undamaged |

## Acceptance criteria

- [ ] AT1–AT4 pass.
- [ ] With zero damage, 065/066/070 tests give unchanged results.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Impact detection (145), debris bodies (147), HUD/setting persistence/repair (148).
- Changing tyre or aero models for undamaged cars; README, tasks.json, milestones.json.

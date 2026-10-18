# 146 — Damage effects on the vehicle (aero, toe, grip, lost wheel)

Status: pending
Phase: 2
Depends on: 070, 144, 145
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The vehicle model changes its behaviour according to its `DamageState`: less downforce, steering pull, less grip, and a dragging chassis when a wheel is lost.

## Context

M2.4, design `docs/plans/late-features.md` ("146"). The car is `VehicleModel` in `src/physics/vehicleModel.ts` (`src/physics/vehicle.ts` only re-exports it as `Vehicle`; edit `vehicleModel.ts`). `src/physics/damage.ts` (144) exists: `DamageState`, `DamageEffects { aeroFront, aeroRear, toe[4], gripScale[4] }`, `createDamageState()`, `damageEffects(state, out?)`. `VehicleModel` has no damage fields yet. Wheel order FL, FR, RL, RR; positive steer = left. Current step flow: wheel rays/suspension, per-wheel `w.steer` (set from `this.steer` for wheels 0-1, 0 for rear), per-wheel `w.grip` (compound x surface x dirt factors) passed as the tyre-solver factor, then `aeroForces(spec, speed, meanX, undefined, this.aeroOut)` and impulses. Effects apply only when `damageMode === 'full'`. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`, `ai/guides/vehicle-dynamics.md`.

## Files

- `src/physics/vehicleModel.ts` — modify: public `damage: DamageState` (init `createDamageState()`), `damageMode: 'off' | 'visual' | 'full'` (default `'full'`; if 145 has landed, import its `DamageMode` from `src/physics/contactEvents.ts` and reuse its fields instead of redeclaring); read `damageEffects(this.damage, this.fx)` each step; add `getDownforce(out?: { front: number; rear: number }): { front: number; rear: number }` (N, last step, after damage scaling).
- `tests/unit/acceptance/146-damage-effects.test.ts` — create (acceptance worker).
- `src/physics/aero.ts` is NOT modified: scale `aeroOut.front/rear` after `aeroForces`. No frozen test changes (zero damage = identical results for 065/066/070).

## Steps

1. Front/rear downforce multiplied by `aeroFront`/`aeroRear`; drag unchanged.
2. Per-wheel `toe` (rad) added to that wheel's steer angle (`w.steer`, after the driver steer).
3. Each wheel's tyre force (longitudinal and lateral) multiplied by `gripScale[i]` (via its `w.grip` factor).
4. Detached wheel `i`: no suspension force and no tyre force from it; wheel ray still ignored; on the transition to detached, add one sphere collider to the chassis body at the corner: radius 0.12 m, centre at (hub x, hub y − wheelRadius + 0.12, hub z) in car-local, friction 0.8, density 0. Created once per detached wheel; removed on `reset()` together with `damage` reset.
5. `damageMode !== 'full'` → all of the above skipped (state still tracked).
6. Reuse one `DamageEffects` object each step (no allocation).

Conventions: SI units; NaN-free outputs for any `DamageState`; `reset(spawn)` clears `damage` in place (fields reset as `createDamageState()` returns).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | Node: f4 at a constant 60 m/s on a flat plane, frontWing 1 | read front downforce | 0.3 × undamaged ± 1 % |
| AT2 | suspension[0] = 1, straight line, steer 0, 30 m/s, 3 s | yaw drift | heading changes ≥ 1° (pull); with no damage < 0.1° |
| AT3 | detached[1] | full throttle 10 s on flat | top speed < 0.92 × undamaged (measured 0.87 with the specified scraping-ball mechanism); no NaN; chassis min y ≥ −0.05 |
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


## Planner-authorised test edits

- `tests/unit/acceptance/146-damage-effects.test.ts` AT3: threshold 0.6 → 0.92 (table updated; the scraping ball is the physical mechanism, no extra drag).
- `tests/unit/edge/146-damage-effects-edge.test.ts` EDGE1 (line ~120): replace the exact `toBe` on front downforce with a relative tolerance of 1e-6.

## Planner answers

- Anti-roll bar 0 on an axle with a detached wheel, NaN sanitisation, `getDownforce` returning applied values, detach ball in `CHASSIS_COLLISION_GROUPS`: accepted.

## Out of scope

- Impact detection (145), debris bodies (147), HUD/setting persistence/repair (148).
- Changing tyre or aero models for undamaged cars; README, tasks.json, milestones.json.

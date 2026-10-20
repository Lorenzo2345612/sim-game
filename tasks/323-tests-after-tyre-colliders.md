# 323 — Master green after the car tyre colliders

Status: pending
Phase: 2
Depends on: none
Complexity: simple
Type: bugfix
Models: standard
Roles: coder, reviewer

## Goal

Master passes again after commit 6c882873 (car-car tyre cylinders + taller body box) and d2fad22c (268): four tests are re-baselined for the intended geometry, and the extra AI resets are fixed in `src`, not hidden.

## Context

Bisect (2026-10-19): 147 AT4, 254 AT2, 269 AT3, edge 093-gaps6 GAPS6-2 and 093 POST10 broke at 6c882873; c0b9998e (ray cache) is innocent.
- 147 AT4 pins `car.chassisCollider`; force events now come from the body box / wheel cylinders.
- 254 AT2: with ≥ 2 colliders Rapier recombines mass properties (principal axes reorder), ~6 mm drift; not physical.
- 093 GAPS6-2 / POST10: slabs and stacked cars start overlapping the new box (+0.25 m) and wheel cylinders; POST10 cars are ejected ~8 m up.
- 269 AT3 (7 neural AIs, resets ≤ 6): 8 resets at 6c882873, 16 at HEAD after 268 (barriers hit tyre colliders); with barriers excluded from tyre colliders still 12, so AI tyre-to-tyre contact also contributes.

## Files

- `src/physics/vehicleModel.ts`, `src/physics/physicsWorld.ts`, `src/physics/contactEvents.ts`, `src/game/raceGame.ts` — modify as needed for 269 AT3.
- Planner-authorised test edits (nothing else in tests):
  - `tests/unit/acceptance/147-debris.test.ts` AT4: the pair matches any collider whose parent is `car.body` (not only `chassisCollider`).
  - `tests/unit/acceptance/254-weight-distribution-rear-grip.test.ts` AT2: re-record the `f4` baseline from current master; keep bit-identical comparison.
  - `tests/unit/edge/093-race-game-gaps6.post.test.ts` GAPS6-2 and `tests/unit/edge/093-race-game.post.test.ts` POST10: move fixtures (slab/stack spacing, heights) so nothing overlaps the new colliders at t = 0; assertions unchanged.

## Steps

1. Apply the three authorised test edits.
2. 269 AT3: measure resets per cause (barrier, car-car, rollover/stall) on the AT3 scenario; fix the dominant causes in `src` (e.g. tyre cylinders only in the car-car collision group so barriers keep hitting the chassis box as before 6c882873; softer/lower-friction tyre-tyre contact). `tests/unit/car-wheel-hitbox.test.ts` (wheels not passable car-car) must still pass.
3. Report resets before/after per cause.

## Acceptance criteria

- [ ] 147, 254, 269 (all ATs; AT8 needs no stray `scripts/evolve/models/*` dirs), 093 edge suites, `car-wheel-hitbox`, 145, 146, 153, 162, 261, 268 pass; 269 AT3 limit stays 6.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/147- tests/unit/acceptance/254- tests/unit/acceptance/269- tests/unit/edge/093- tests/unit/car-wheel-hitbox tests/unit/acceptance/145- tests/unit/edge/146- tests/unit/edge/153- tests/unit/acceptance/162- tests/unit/acceptance/261- tests/unit/acceptance/268-
```

## Out of scope

Removing the tyre colliders, raising the 269 reset limit, AI behaviour changes beyond contact.

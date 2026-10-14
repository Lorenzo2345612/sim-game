# 162 — Speed-dependent rolling drag on grass and gravel

Status: pending
Phase: 1
Depends on: 065
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Grass and gravel slow the car down the way real off-track surfaces do. Today the user reaches 190 km/h on grass. After this task, flat out on grass tops out near 110 km/h after 20 s, and gravel traps stop a car arriving at 200 km/h within about 140 m.

## Context

Today `SURFACE_DRAG` (`src/core/constants.ts`) is a constant fraction of m·g per wheel, and `SURFACE_GRIP` scales tyre grip. Grip stays as it is.

This task replaces the drag with load-proportional rolling resistance that grows with speed. Real grass and gravel resist more the faster the tyre ploughs through.

The values were calibrated in the planner lab with the 065 model (`SURF='{"grip":..,"c0":..,"c1":..}' node ai/lab/vehicle-model.mjs off`):

| Surface | c0, c1 | Flat out, 20 s | Coast 200 → 5 km/h |
|---|---|---|---|
| Grass | 0.10, 0.004 | 109.5 km/h | 406 m |
| Gravel | 0.08, 0.03 | 14.2 km/h, so the car can crawl out | 137 m |

## Files

- `src/core/constants.ts` — modify — `SURFACE_DRAG` becomes `Record<Surface, { c0: number; c1: number }>`.
- `src/physics/surfaceDrag.ts` — create — `rollingDrag`.
- `src/physics/trackColliders.ts` — modify — export `registerSurface`.
- `src/physics/vehicle.ts` — modify — use `rollingDrag` per wheel.
- `tests/unit/physics/surfaceDrag.test.ts` — create — edge cases.
- Planner-authorised edits to superseded constant-drag assertions (exactly these):
  - `tests/unit/acceptance/022-types-and-constants-v2.test.ts:50-55`: `SURFACE_DRAG.grass` → `{ c0: 0.10, c1: 0.004 }`, `.gravel` → `{ c0: 0.08, c1: 0.03 }`, asphalt/kerb/runoff `{ c0: 0, c1: 0 }` (toEqual).
  - `tests/unit/edge/033-surface-grip-edge.test.ts:185` (EDGE6) and `:218` (EDGE8): expected deceleration from `rollingDrag(surface, v, fz) / (m/4)` per wheel at the test's speed instead of `SURFACE_DRAG.gravel * g`; keep the same tolerance band shape.

## Steps

```ts
// constants.ts: asphalt/kerb/runoff {0, 0}; grass {c0: 0.10, c1: 0.004}; gravel {c0: 0.08, c1: 0.03} (c1 in s/m)
export function rollingDrag(surface: Surface, vLong: number, fz: number): number; // N, >= 0: (c0 + c1*|vLong|) * max(fz, 0)
export function registerSurface(collider: RAPIER.Collider, surface: Surface): void; // surfaceOf(collider) then returns it
```

1. In `Vehicle.prePhysicsStep`, for each wheel in contact:
   - Add a longitudinal force of magnitude `rollingDrag(surface, vLong, fz)` opposite to the wheel's longitudinal velocity. `vLong` is the hub velocity along the wheel's forward direction.
   - Apply it at the contact point, together with the tyre force.
   - Clamp it so that, in one tick, it can at most cancel that wheel's share (m/4) of `vLong`. It never reverses the motion.
2. Remove the old constant-drag impulse. `SURFACE_GRIP` is unchanged.
3. Non-finite `vLong` or `fz` → `rollingDrag` returns 0.

## Acceptance tests (defined by the planner with Opus, before coding)

The integration rows use the 065 vehicle on a large flat cuboid collider registered with `registerSurface`. They follow the same construction as `tests/unit/acceptance/065-*.test.ts`, with the F4 spec from `public/cars/f4.json` and `FIXED_DT` steps.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | unit | `rollingDrag('grass', 20, 1500)` / `('gravel', 20, 1500)` / `('gravel', -20, 1500)` / `('asphalt', 50, 1500)` / `('kerb', 50, 1500)` | 270 / 1020 / 1020 / 0 / 0 (± 1e-9) |
| AT2 | unit | `rollingDrag('grass', NaN, 1500)` / `('grass', 20, -5)` | 0 / 0 |
| AT3 | flat grass, standstill | full throttle 20 s | speed 90–130 km/h |
| AT4 | flat gravel, standstill | full throttle 20 s | speed 5–30 km/h (moves, can crawl out) |
| AT5 | flat gravel, chassis linear velocity set to 200 km/h forward and wheel spin to match (ω = v/R) | coast (no throttle, no brake) until speed < 5 km/h | distance 100–180 m |
| AT6 | flat grass, same as AT5 | same | distance 300–520 m |
| AT7 | flat asphalt (unregistered collider) | full throttle 6 s | speed > 100 km/h (065 AT5 still holds) |

## Acceptance criteria

- [ ] AT1–AT7 pass; the existing vehicle tests are green.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Dirty tyres, vibration, particles, sound (separate tasks).
- Changing `SURFACE_GRIP`.

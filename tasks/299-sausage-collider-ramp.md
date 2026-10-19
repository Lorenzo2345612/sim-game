# 299 — Low-ramp sausage kerb collider seated on the ground

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Running a wheel over a sausage kerb on the inside of a corner upsets the car slightly instead of acting like a wall.

## Context

User report: the inner kerb sometimes behaves like a wall. Measured (cleveland sausage 0, f4 at 25 m/s): the 0.13 m collider is taller than the f4 suspension travel (0.10 m), so the wheel ray hits the bump stop on a 46° flank (hit normal ny 0.69). Peak wheel fz reaches 16–29 kN (7 kN otherwise) and yaw rate 0.53 rad/s. A collider 0.08 m high, 0.7 m base and 0.2 m top gives 6.4–8.0 kN and ≤ 0.15 rad/s (measured with the same runs). The visual mesh stays as it is (0.13 m; tests 150 are unchanged).
Second defect: `sausagePieces` y comes from the apex row elevation, so pieces float above the strips below them (base − ground, worst per sausage: mexico 646r +0.45 m, 577r +0.19, 622l +0.14; monza 311r +0.16, 328l +0.11), i.e. a 0.3–0.6 m step.

## Files

- `src/track/sausages.ts` — modify — `SAUSAGE_COLLIDER_HEIGHT = 0.08`, `SAUSAGE_COLLIDER_BASE_WIDTH = 0.7`, `SAUSAGE_COLLIDER_TOP_WIDTH = 0.2` (m) and `export function sausageColliderPoints(length: number): Float32Array` (same 8-corner trapezoid prism layout as `sausageHullPoints`, base at y 0). `sausageHullPoints` and the `SAUSAGE_*` visual constants stay unchanged.
- `src/physics/trackColliders.ts` — modify — `addSausageColliders` uses `sausageColliderPoints` and sets each piece collider's base y to the height of the surface strips directly below the piece centre (downward ray against the strip colliders already created; update the scene queries first). If the ray misses, keep the piece y.
- Planner-authorised edits (collider top now 0.08 m, ray from y 5 hits at 4.92): `tests/unit/edge/150-sausage-render.post.test.ts` line ~239, `tests/unit/edge/150-sausage-render-edge.test.ts` line ~239, `tests/unit/edge/247-sausage-fit-corner-edge.test.ts` line ~440: `toBeCloseTo(4.87, 3)` → `expect(Math.abs(hit.timeOfImpact - 4.92)).toBeLessThanOrEqual(0.02)` and the message text 0.13 → 0.08. Nothing else in those files.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `sausageColliderPoints(6)` | read the 24 floats | 8 corners; y ∈ {0, 0.08}; at y 0 \|x\| = 0.35, at y 0.08 \|x\| = 0.1; \|z\| = 3 (± 1e-6) |
| AT2 | straight test track with one sausage (right, offset 7.8, length 6), `createPhysicsWorld(track)` + 5 world steps | downward ray from y 5 at `sausagePose` | hits a `'kerb'` collider at timeOfImpact 5 − 0.08 − (ground y under the pose in the same track without sausages) ± 1e-3, and within 4.92 ± 0.02 |
| AT3 | `public/tracks/cleveland.json` world (`createPhysicsWorld`), sausage 0 (index 580, right, offset 9.3, length 20). f4 `VehicleModel` placed 14 m before the first piece along the first piece's direction, laterally 0.5 m toward the track from the sausage centre line, on the ground + 0.5 m, linvel 25 m/s along heading, wheel omega = 25 / 0.28, 4 upshifts, input throttle 0.3 steer 0 | step 1.3 s at 1/120, ignore the first 30 steps | max over wheels and steps of `getTelemetry().wheels[k].fz` ≤ 10 000 N; max \|body.angvel().y\| ≤ 0.25 rad/s |
| AT4 | same as AT3 with lateral 0 and with heading rotated 10° toward the sausage side | same | same bounds |
| AT5 | `sausageHullPoints(6)` | read | unchanged (max y 0.13, base \|x\| 0.25) |
| AT6 | mexico, monza, cleveland: world A = `createPhysicsWorld(track)`, world B = same track with `sausages: []`, both stepped twice | for every sausage piece collider in A (surface `'kerb'`, convex hull), downward ray in B at its translation x,z | \|collider translation y − B hit y\| ≤ 0.03 m |

## Acceptance criteria

- [ ] AT1–AT5 pass; all 149, 150, 174, 247, 249 tests pass with only the authorised edits.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/299- tests/unit/acceptance/149- tests/unit/acceptance/150- tests/unit/acceptance/247- tests/unit/edge/150- tests/unit/edge/174- tests/unit/edge/247-
```

## Out of scope

- Sausage visuals (a floating visual mesh is a separate task), placement (`sausagePose`, offsets in track JSON), vehicle suspension model.

## Planner answers (round 1)

Planner-authorised edit of `tests/unit/acceptance/150-sausage-render.test.ts` AT2 only: the "with sausage" bound becomes `toBeGreaterThan(0.5)` (measured 0.71 with the 0.08 m collider) and the title "peaks above 0.5 m/s"; the "without" bound (< 0.3) is unchanged. Nothing else in 150 changes.

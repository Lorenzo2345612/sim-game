# 145 — Contact impacts from Rapier into the damage model

Status: pending
Phase: 2
Depends on: 070, 093, 144
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Collisions of a car chassis with walls or other cars call `applyImpact` on the affected cars' `DamageState`.

## Context

M2.4, design `docs/plans/late-features.md` ("145"). Read the current code first: this task runs after 144, 070 (`src/physics/vehicle.ts`, `Vehicle` on `CarSpec`) and 093 (`src/game/raceGame.ts`, cars collide with each other); adapt file names to what exists, keep the public contract. Rapier: `ActiveEvents.CONTACT_FORCE_EVENTS`, `contactForceEventThreshold` 1000 N on each chassis collider, `world.step(eventQueue)`, `eventQueue.drainContactForceEvents`. Car local frame −Z forward. This task also introduces the `DamageMode` type (148 adds UI/persistence). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`. e2e is not needed.

## Files

- `src/physics/contactEvents.ts` — create.
- `src/physics/vehicle.ts` — modify: public `damage: DamageState`, `zones: CarZones` (halfLength/halfWidth from the chassis half extents, hubs = wheel hub positions from the spec in car-local metres), `chassisCollider: RAPIER.Collider`, `damageMode: DamageMode` (default `'full'`); chassis collider gets the force-event flag and threshold.
- `src/game/raceGame.ts` — modify: owns the `EventQueue`, steps the world with it, calls `processContactEvents` each tick; query `?damage=off|visual|full` (invalid → `full`) sets `damageMode` of every car (parsed in `src/main.ts` if that is where queries are read).
- `tests/unit/acceptance/145-contact-impacts.test.ts` — create (acceptance worker).

## Steps

```ts
import type { Vec3 } from '../core/types';
export type DamageMode = 'off' | 'visual' | 'full'; // exported from contactEvents.ts
export function toLocalPoint(world: Vec3, carPos: Vec3, carQuat: { x: number; y: number; z: number; w: number }, out: Vec3): Vec3; // inverse(q)·(world − carPos), writes and returns out
export interface DamageCar { chassis: RAPIER.Collider; body: RAPIER.RigidBody; zones: CarZones; damage: DamageState; damageMode: DamageMode }
export function processContactEvents(queue: RAPIER.EventQueue, world: RAPIER.World, cars: readonly DamageCar[], dt: number, rng: () => number): void;
```

1. Per contact force event: for each of the two colliders that is a car chassis in `cars`: J = `totalForceMagnitude · dt`; point = first world contact point of the manifold between both colliders (`world.contactPair`) converted with `toLocalPoint`; `otherCar` = the other collider is a chassis in `cars`; call `applyImpact(car.damage, {impulse: J, point, otherCar}, car.zones, rng)`.
2. Both cars of a car-to-car contact receive the same J.
3. `damageMode === 'off'` → that car's events are ignored. `'visual'` and `'full'` both accumulate damage.
4. `rng` = seeded mulberry32 from the race seed (no `Math.random`). No per-tick allocation beyond what Rapier returns; reuse temporaries.

Conventions: `dt` ≤ 0 or non-finite → no-op; events whose collider is not in `cars` are ignored; `out` is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: car at (10, 0, 5), quaternion = +90° about +Y (car forward −Z maps to world −X), world point (10, 0.3, 3) | toLocalPoint | (2, 0.3, 0) ± 1e-9 |
| AT2 | Node: f4 driven straight into a wall at 30 m/s (head-on) | 2 s | frontWing ≥ 0.5; at 5 m/s: frontWing 0 |
| AT3 | Node: two cars, car B hits stationary car A's rear at 20 m/s | 2 s | A.rearWing > 0 and B.frontWing > 0; |A.J − B.J| ≤ 1e-6·J for the first contact event |
| AT4 | damage setting off | AT2 at 30 m/s | all damage 0 |

## Acceptance criteria

- [ ] AT1–AT4 pass; 093 determinism test still passes (same seed → same damage).
- [ ] A car in free driving without contacts keeps `damage` at zero over 60 s.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying damage to dynamics (146), debris (147), HUD, UI setting, repair, AI (148).
- README, tasks.json, milestones.json.

## Planner answers

Verified Rapier API (`@dimforge/rapier3d-compat` `.d.ts`; do not read the minified bundle or wasm):

```ts
chassisDesc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(1000);
world.step(eventQueue);                                   // raceGame owns one EventQueue(true)
eventQueue.drainContactForceEvents((e) => {               // e is only valid inside the closure
  const c1 = world.getCollider(e.collider1());
  const c2 = world.getCollider(e.collider2());
  const jRaw = e.totalForceMagnitude() * dt;
  world.contactPair(c1, c2, (m, _flipped) => {
    if (m.numSolverContacts() > 0) m.solverContactPoint(0, tmpWorld); // world-space point, reuse tmpWorld
  });
});
```
Map collider handle → car with a `Map<number, DamageCar>` built once per `cars` array (cache it; no per-tick rebuild).

Calibration (fixes AT2's 5 m/s case): per-tick `jRaw` of a rigid stop is ≈ m·v (f4 `massKg` 650 → ≈ 3250 N·s at 5 m/s, above `WING_J0` 1500). Pass `J = max(0, jRaw − mRed · V_SAFE)` to `applyImpact`, with `V_SAFE = 6` m/s exported from `contactEvents.ts`, `mRed` = the car's mass for a wall/static contact and `m1·m2/(m1+m2)` for car–car (body `mass()`). Both cars of a car–car event get the same J (AT3). Expected: 30 m/s wall → J ≈ 15600 → frontWing 1; 5 m/s → 0; AT3 20 m/s → J ≈ 4550 each. Do not change `damage.ts` constants.

Budget: if AT2/AT3 still fail after this, run each AT at most twice more, then report BLOCKED with the per-tick `jRaw` series of the first contact (no wasm/bundle digging).

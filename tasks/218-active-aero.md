# 218 — Active-aero state and aero blend

Status: pending
Phase: 1
Depends on: 215
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

An `ActiveAero` state machine with a blend 0..1 and an `aeroForces` extension that scales drag and downforce by that blend.

## Context

Types from `./hybridTypes` (215): `ActiveAeroSpec`; `CarSpec.activeAero` from `src/physics/carSpec.ts`. `aeroForces` is in `src/physics/aero.ts`; existing callers (e.g. `vehicleModel.ts` line ~543) pass 5 args and must behave identically.

## Files

- `src/physics/activeAero.ts` — create
- `src/physics/aero.ts` — modify
- `tests/unit/acceptance/218-active-aero.test.ts` — create (acceptance worker)

## Steps

1. `src/physics/activeAero.ts`: `export class ActiveAero { blend: number; constructor(spec: ActiveAeroSpec); update(inZone: boolean, throttle: number, brake: number, dt: number): number; reset(): void; get straightMode(): boolean }` (`update` returns the new blend).
2. target = inZone && throttle >= 0.9 && brake < 0.05 ? 1 : 0; blend moves linearly toward target by dt / transitionS, clamped to [0, 1]. `straightMode` = blend >= 0.5. `reset()` → blend 0. No allocation in `update`.
3. `aeroForces(spec, speedMs, rideDrop, setup?, out?, activeBlend?: number): AeroForces`. When `spec.activeAero` is set and clamped activeBlend b > 0: final cda *= (1 - b*(1 - dragScale)); final claFront and claRear *= (1 - b*(1 - downforceScale)); applied after the ride-height and wing-setup terms and before the existing `Math.max(0, ...)`. Otherwise identical to today.

Conventions: blend clamped to [0, 1] and `activeBlend` clamped to [0, 1] (NaN treated as 0); `throttle >= 0.9`, `brake < 0.05` as written; `spec` not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/218-active-aero.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | ActiveAero {0.7, 0.6, 0.4}, dt 1/120 | 24 updates (zone, throttle 1, brake 0) | blend 0.5 (±1e-9), straightMode true; after 48 total: 1 |
| AT2 | blend 1 | updates with brake 0.1 | blend 0 after exactly 48 updates (0 at 48, > 0 at 47) |
| AT3 | blend 0 | 60 updates each with: throttle 0.89; out of zone; brake 0.05 | blend stays 0 |
| AT4 | f4 spec + activeAero {0.7, 0.6, 0.4}, aero overridden to cda 1.0, claFront 1.5, claRear 2.0, rideHeightSens 0 | `aeroForces(spec, 50, 0, undefined, undefined, b)` for b = 0, 1, 0.5 | drag/front/rear = 1531.25/2296.875/3062.5; 1071.875/1378.125/1837.5; 1301.5625/1837.5/2450 (±1e-6) |
| AT5 | same spec without activeAero | blend 1 | same as b = 0 |
| AT6 | AT4 spec | blend −1 and 2 | same as b = 0 and b = 1 |

## Acceptance criteria

- [ ] Acceptance table passes.
- [ ] Existing aero tests (061, 070) still pass unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into VehicleModel (219), zone detection, HUD.

# 061 — Suspension, anti-roll and aero

Status: pending
Phase: 1
Depends on: 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure functions for suspension force, anti-roll bar and aerodynamic forces.

## Context

Guide: `ai/guides/vehicle-dynamics.md` ("Wheel and suspension", "Aero and fuel"; do not restate). Types from `src/physics/carSpec.ts` (058). No `three`, no Rapier. Constants: air density 1.225 kg/m³.

## Files

- `src/physics/suspension.ts` — create.
- `src/physics/aero.ts` — create.
- `tests/unit/acceptance/061-suspension-aero.test.ts` — create (acceptance worker).

## Steps

```ts
// suspension.ts
import type { CarSpec } from './carSpec';
export type AxleSpec = CarSpec['suspension']['front'];
export function staticCompression(fzStatic: number, springRate: number): number;  // fzStatic / springRate
export function suspensionForce(axle: AxleSpec, x: number, xDot: number): number;
export function antiRoll(arb: number, xLeft: number, xRight: number): number;  // arb·(xLeft − xRight)
// aero.ts
export const AIR_DENSITY = 1.225;
export interface AeroForces { front: number; rear: number; drag: number }
export function aeroForces(spec: CarSpec, speedMs: number, rideDrop: number, setup?: {frontWing:number; rearWing:number}, out?: AeroForces): AeroForces;
```

- `suspensionForce`: x = compression in m (clamped to [0, travel] for spring/damper), spring = springRate·x; damper = bumpDamping·xDot if xDot > 0 else reboundDamping·xDot; bump stop adds bumpStopRate·(x − travel) when x > travel (the spring/damper term uses the clamped x). Result clamped to ≥ 0.
- `antiRoll` returns the value added to the left wheel; the caller subtracts it from the right.
- `aeroForces`: front = ½·ρ·ClAf'·v², rear = ½·ρ·ClAr'·v², drag = ½·ρ·CdA'·v² (N, magnitudes; downforce positive). `rideDrop` = static ride height − current mean ride height (m, positive when lower); ClA' = ClA + `aero.rideHeightSens`·rideDrop (front and rear).
- With `setup`: ClAf' += `wingStep.claFront`·(frontWing − `spec.setup.frontWing.default`); ClAr' += `wingStep.claRear`·(rearWing − `spec.setup.rearWing.default`); CdA' += `wingStep.cda`·(rearWing − `spec.setup.rearWing.default`). Without `setup`: no wing delta. `out` is reused when given.

Conventions: no rounding; speed 0 → all zero; negative speed uses |speed|; ClA' floored at 0 (also after the ride-height term); `suspensionForce` never negative (never pulls); no input mutated except `out`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/061-suspension-aero.test.ts` before the coder starts. Nobody else may change these rows or tests. F4 = `public/cars/f4.json` parsed with `parseCarSpec`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | k 52000, x 0.02, xDot 0 | suspensionForce | 1040 N |
| AT2 | xDot +0.1 vs −0.1 | force | uses bumpDamping for positive, reboundDamping for negative |
| AT3 | x = travel + 0.01 | force | includes bumpStopRate·0.01 |
| AT4 | strong rebound (x 0.001, xDot −1) | force | 0 (never pulls) |
| AT5 | arb 18000, xL 0.03, xR 0.01 | antiRoll | +360 (left gets +360, right −360) |
| AT6 | F4, 50 m/s, rideDrop 0, default setup | aero | front = ½·1.225·0.8·2500 = 1225 N ± 1e-6; rear 1837.5; drag ½·1.225·0.8·2500 |
| AT7 | rearWing default + 2 steps | aero | claRear + 2·0.09 and cda + 2·0.015 reflected |
| AT8 | speed 0 | aero | all zero |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No imports from `three`/Rapier; `aeroForces` allocates nothing when `out` is given.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Ray casting, applying forces to Rapier bodies, per-wheel velocity (damper xDot) computation, setup clamping (067).

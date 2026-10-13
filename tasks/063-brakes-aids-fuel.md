# 063 — Brakes, ABS/TC and fuel

Status: pending
Phase: 1
Depends on: 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure brake torque distribution, ABS and traction-control scaling, and a fuel tank that burns by engine power.

## Context

Design: `ai/guides/vehicle-dynamics.md` (Powertrain, brakes, aids; Aero and fuel). Reference: `ai/lab/vehicle-model.mjs`. `CarSpec` from `src/physics/carSpec.ts` (task 058). Pure TypeScript, no `three`, no Rapier.

## Files

- `src/physics/brakes.ts` — create
- `src/physics/fuel.ts` — create
- `tests/unit/physics/brakesFuel.test.ts` — create (edge cases)

## Steps

```ts
import type { CarSpec } from './carSpec';
export function brakeTorques(brakes: CarSpec['brakes'], pedal: number, bias: number, out: number[]): void; // out length 4: FL, FR, RL, RR
export function absScale(abs: CarSpec['aids']['abs'], kappa: number, speed: number): number; // 0.5 or 1
export function tcScale(tc: CarSpec['aids']['tc'], drivenKappas: number[]): number;          // 0.5 or 1
export function fuelFlowKgS(bsfc: number, powerW: number, mult: number): number;
export class FuelTank {
  massKg: number; litres: number;
  constructor(spec: CarSpec['fuel'], startL?: number); // startL defaults to spec.startL
  burn(powerW: number, dt: number, mult: number): void;
  empty(): boolean;
}
```

- Torque per wheel = pedal·maxTorque·(bias/2 front, (1 − bias)/2 rear); pedal clamped 0..1; the `bias` argument overrides `brakes.bias`.
- ABS active only if `enabled` and speed > 3 m/s and kappa < −slip: returns 0.5. TC: `enabled` and any kappa > slip returns 0.5.
- `fuelFlowKgS` = bsfc[g/kWh]·max(0, powerW)/3.6e9·mult. `burn` reduces `massKg` by flow·dt, never below 0; `litres` = massKg/densityKgL; negative power burns nothing; `startL` clamped to 0..capacityL.

Conventions: ABS/TC thresholds strict (`<`, `>`); speed boundary strict (`> 3`); NaN pedal = 0; `out` is mutated, other inputs are not.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | maxTorque 4200, pedal 1, bias 0.6 | brakeTorques | [1260, 1260, 840, 840] |
| AT2 | pedal 0.5 | same | halves |
| AT3 | ABS slip 0.12, kappa −0.2, speed 10 | absScale | 0.5; speed 2 → 1; kappa −0.05 → 1; abs disabled → 1 |
| AT4 | TC slip 0.2, kappas [0.1, 0.3] | tcScale | 0.5; [0.1, 0.1] → 1 |
| AT5 | bsfc 250 g/kWh, 100 kW, mult 1 | fuelFlowKgS | 250·100/3.6e6 kg/s ± 1e-9 |
| AT6 | tank 20 L, density 0.745 | burn at 100 kW for 60 s, mult 2 | mass drop = 2·AT5·60 ± 1e-6; never below 0; `empty()` when 0 |
| AT7 | negative power (engine braking) | burn | no fuel used |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Neither file imports `three` or Rapier.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying brake torque to wheels (064/065), Rapier mass update on fuel change (065), HUD fuel display.

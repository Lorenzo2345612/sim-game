# 283 — CarSpec `drive: 'awd'` and `electric` block (parse)

Status: pending
Phase: 7
Depends on: 281
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`parseCarSpec` accepts `drive: 'awd'` together with an `electric` block and exposes it typed on `CarSpec`. Existing cars parse exactly as before.

## Context

Design: `docs/design/m7.1-electric.md`. Follow the existing helpers and message style in `src/physics/carSpec.ts` (`num`, `enumStr`, `fail(path)` -> `Invalid car spec: <path> is missing or invalid`). Combustion fields (engine, gearbox, fuel) stay required. `chassis.massKg` convention (guides/vehicle-dynamics.md): with driver, no fuel.

## Files

- `src/physics/carSpec.ts` — modify
- `tests/unit/acceptance/283-carspec-awd-electric.test.ts` — create (from the table)

## Steps

```ts
import type { MotorSpec } from './electric';
// CarSpec changes:
drive: 'rwd' | 'awd';
electric?: {
  front: MotorSpec; rear: MotorSpec; batteryJ: number; efficiency: number;
  modes: { race: number; attack: number };
  attack: { activations: number; durationS: number };
};
```

1. `drive` enum becomes `['rwd', 'awd']`.
2. `drive: 'awd'` requires the `electric` block; `electric` present with `rwd` is invalid. Both throw `Invalid car spec: <path> is missing or invalid` with path `electric` (or the first bad field).
3. Field paths and validity: `electric.{front,rear}.{maxPowerW,maxTorqueNm,maxRpm,ratio,regenMaxW}` all finite > 0; `electric.batteryJ` > 0; `electric.efficiency` in (0, 1]; `electric.modes.race` and `.attack` > 0; `electric.attack.activations` integer ≥ 1; `electric.attack.durationS` > 0.
4. Rwd cars: `electric` stays `undefined` (key absent). Nothing else in `CarSpec` changes; fix any `tsc` error caused by the widened `drive` type without changing behaviour.

Conventions: invalid or missing field throws (never clamps); first failing field reported; input JSON not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | f4.json, ow26.json, all public/cars | parse | unchanged (drive 'rwd', electric undefined) |
| AT2 | ow26 json with drive 'awd' + valid electric block | parse | electric.rear.maxPowerW 350000, modes.attack 600000 |
| AT3 | drive 'awd' without electric / electric with 'rwd' / electric.front.ratio −1 / modes.race 0 | parse | throws `Invalid car spec` naming the field |

## Acceptance criteria

- [ ] All ATs pass; existing carSpec tests unchanged and green.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- VehicleModel behaviour (284), `public/cars/eow.json` (286), sound parsing, defaults for missing electric fields.

# 166 — Dirty tyres

Status: pending
Phase: 1
Depends on: 065, 162
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Tyres pick up dirt on grass and gravel and lose grip on the track until it is cleaned off by driving on clean surfaces.

## Context

Vehicle model from 065 (`src/physics/vehicle.ts`, `Telemetry`/`WheelTelemetry` per `tasks/065-vehicle-model.md`). Off-track drag is 162. Dirt per wheel is 0..1. `Surface` from `src/core/types.ts`. Grass/gravel grip is unchanged (factor 1); dirt only reduces grip on asphalt/kerb/runoff.

## Files

- `src/physics/tyreDirt.ts` — create (pure).
- `src/physics/vehicle.ts` — modify: per-wheel `dirt` state (preallocated), updated each tick with the wheel's surface and wheel-centre speed from `|forwardSpeed|` and `FIXED_DT`; tyre mu multiplied by `dirtGripFactor`; `reset()` zeroes dirt; `WheelTelemetry` gains `dirt: number`.
- `tests/unit/acceptance/166-dirty-tyres.test.ts` — create (AT7/AT8 build the world like the 162 tests).

## Steps

```ts
import type { Surface } from '../core/types';
export const DIRT_PICKUP: Record<Surface, number>; // per metre rolled: grass 0.02, gravel 0.04, others 0
export const DIRT_CLEAN_LENGTH = 400; // m, exponential cleaning on asphalt/kerb/runoff
export const DIRT_GRIP_LOSS = 0.25;
export function updateDirt(dirt: number, surface: Surface, speed: number, dt: number): number;
// d = |speed|·dt; grass/gravel: min(1, dirt + DIRT_PICKUP·d); others: dirt·exp(−d/DIRT_CLEAN_LENGTH)
export function dirtGripFactor(dirt: number, surface: Surface): number; // asphalt/kerb/runoff: 1 − DIRT_GRIP_LOSS·clamp01(dirt); grass/gravel: 1
```

Conventions: non-finite dirt → 0; non-finite speed or dt, or dt < 0 → dirt unchanged (clamped 0..1); result always in 0..1; pure, no mutation.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | dirt 0 | updateDirt(0,'gravel',10,1) / (0,'grass',10,1) | 0.4 / 0.2 (±1e-12) |
| AT2 | dirt 0.9 | updateDirt(0.9,'gravel',30,1) | 1 |
| AT3 | dirt 1 | updateDirt(1,'asphalt',40,10) / (1,'kerb',40,10) / (1,'runoff',40,10) | e^-1 each (±1e-12) |
| AT4 | negative speed | updateDirt(0,'grass',−10,1) | 0.2 |
| AT5 | bad input | updateDirt(NaN,'grass',10,1) / (0.5,'grass',NaN,1) / (0.5,'grass',10,−1) | 0.2 / 0.5 / 0.5 |
| AT6 | grip | dirtGripFactor(1,'asphalt') / (0.5,'kerb') / (1,'grass') / (1,'gravel') / (0,'asphalt') / (3,'asphalt') | 0.75 / 0.875 / 1 / 1 / 1 / 0.75 |
| AT7 | F4 (public/cars/f4.json) spawned on a large flat gravel cuboid registered with registerSurface (same construction as 162 tests) | getTelemetry at spawn; then 2 s full throttle | every wheel dirt 0 at spawn; every rear wheel dirt > 0 after 2 s, all ≤ 1 |
| AT8 | after AT7 | vehicle.reset(spawn); getTelemetry | every wheel dirt 0 |

## Acceptance criteria

- [ ] All AT rows pass; existing vehicle tests still pass (dirt 0 gives factor 1, no numeric change).
- [ ] Protected tests: none change numbers.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wet grass, gravel dragged onto the track, visual dirt on the car, HUD display, tyre-change cleaning.

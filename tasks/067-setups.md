# 067 — Car setups (pure)

Status: pending
Phase: 1
Depends on: 058
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Pure functions to define, clamp, preset, apply and persist the eight setup values of a car.

## Context

`ai/guides/vehicle-dynamics.md` section "Setups". `CarSpec`, `SetupKey` and its `setup` ranges (`SetupRanges`)/`presets` come from `src/physics/carSpec.ts` (task 058; import, do not redefine). No `three`, no Rapier.

## Files

- `src/physics/setup.ts` — create
- `tests/unit/physics/setup.test.ts` — create — extra edge tests

## Steps

```ts
import type { CarSpec, SetupKey } from './carSpec';
export type Setup = Record<SetupKey, number>;  // frontWing, rearWing, brakeBias, finalDrive, arbFront, arbRear, rideHeight, tyrePressureKpa
export type PresetName = 'stable' | 'balanced' | 'aggressive';
export type SetupStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function defaultSetup(spec: CarSpec): Setup;
export function presetSetup(spec: CarSpec, name: PresetName): Setup;
export function clampSetup(spec: CarSpec, s: Setup): Setup;
export function applySetup(spec: CarSpec, s: Setup): CarSpec;
export function saveSetup(carId: string, trackId: string, s: Setup, storage: SetupStorage): void;
export function loadSetup(carId: string, trackId: string, spec: CarSpec, storage: SetupStorage): Setup;
```

- `applySetup` returns a new deep-copied spec (input never mutated): wings add `(value − default)·wingStep` to `aero.claFront/claRear` and `cda` (cda delta uses front and rear steps' `cda` once per step of each wing); `brakeBias` → `brakes.bias`; `finalDrive` → `gearbox.final`; arbs → `suspension.front/rear.arb`; `rideHeight` adds to every wheel hub y and to `chassis.cgHeight`; `tyrePressureKpa` → `tyres.pressureKpa` (field defined in 058).
- Storage key `setup:<carId>:<trackId>`, JSON of `Setup`. `loadSetup` returns `defaultSetup` when missing, unparsable or not an object of 8 finite numbers; result is passed through `clampSetup`.
- `presetSetup` returns a copy of `spec.presets[name]`.

Conventions: `clampSetup` clamps to [min, max] inclusive, then rounds to the nearest step from min (half rounds up); wings are integers; NaN/non-finite value → default; never throws; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | default setup | applySetup | deep-equal to the input spec's physical values |
| AT2 | rearWing +2 | applySetup | aero.claRear += 0.18, cda += 0.03; input spec unchanged |
| AT3 | brakeBias 0.55, finalDrive 3.6 | apply | brakes.bias 0.55, gearbox.final 3.6 |
| AT4 | rideHeight −0.01 | apply | every hub y −0.01, cgHeight −0.01 |
| AT5 | out-of-range values / non-step values | clampSetup | clamped to [min, max] and rounded to step |
| AT6 | save then load same car+track | storage mock | equal; other track → default; corrupt JSON → default |
| AT7 | `presetSetup('stable')` | values | equals `spec.presets.stable` |

## Acceptance criteria

- [ ] AT1–AT7 pass; `npm run typecheck` and `npm run lint` clean.
- [ ] `setup.ts` imports nothing from `three` or Rapier.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

UI, wiring into the game, new setup parameters, changing `f4.json`.

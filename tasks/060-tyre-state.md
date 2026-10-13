# 060 — Tyre temperature, wear and pressure

Status: pending
Phase: 1
Depends on: 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure per-tyre thermal and wear state with grip factors for temperature, wear and pressure.

## Context

Guide: `ai/guides/vehicle-dynamics.md` ("Tyre model": temperature, wear, pressure formulas; do not restate). `TyreCompound` from `src/physics/carSpec.ts` (058); data from `public/cars/f4.json` `medium`. No `three`, no Rapier.

## Files

- `src/physics/tyreState.ts` — create.
- `tests/unit/acceptance/060-tyre-state.test.ts` — create (acceptance worker).

## Steps

```ts
import type { TyreCompound } from './carSpec';
export const AMBIENT_C = 25;
export interface TyreState { tempC: number; wear: number }
export function newTyreState(): TyreState;  // tempC 70, wear 0
export function updateTyreState(s: TyreState, c: TyreCompound, slipPower: number, speed: number, dt: number, wearMult: number, pressureKpa: number, optPressureKpa: number): void;
export function tempFactor(c: TyreCompound, tempC: number): number;
export function wearFactor(c: TyreCompound, wear: number): number;
export function pressureFactor(p: number, opt: number): number;
export function gripFactor(c: TyreCompound, s: TyreState, p: number, opt: number): number;
```

- `slipPower` = |Fx·vslipx + Fy·vslipy| in W (caller computes); `speed` = |v| m/s.
- Heating: dT = (heatCoef·(p/opt)·slipPower − coolCoef·(T − AMBIENT_C)·(1 + 0.05·speed))·dt. Wear: dW = wearRate·slipPower·wearMult·dt. Both per guide.
- `tempFactor`, `wearFactor`, `pressureFactor` exactly per guide (floors: temp 0.75, pressure 0.9). `gripFactor` = product of the three.
- `updateTyreState` mutates `s` in place, uses explicit Euler, allocates nothing.

Conventions: no rounding; `wear` clamped to [0, 1] after each update; `tempC` not clamped; non-finite or negative `slipPower`/`dt` treated as 0; `wearMult` < 0 treated as 0; `wearFactor` input clamped to [0, 1]; boundaries: cliff applies only for `wear > cliffWear`; only `s` is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/060-tyre-state.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | medium, T = optTempC | `tempFactor` | 1 |
| AT2 | T = optTempC ± tempWindowC | tempFactor | 0.75 ± 1e-9 both sides; T = opt ± 3·window → 0.75 (floor) |
| AT3 | wear 0 / 0.5 / 1.0, cliff 0.8, gripLoss 0.25 | wearFactor | 1 / 0.875 / 1 − 0.25 − 0.15 = 0.60 (± 1e-9) |
| AT4 | slipPower 0, speed 0, T 90 | update 600 s (dt 1/120) | T → 25 ± 2 °C monotonically, wear unchanged |
| AT5 | slipPower 20 kW constant, speed 30 | update 60 s | T rises, wear = wearRate·20000·60 ± 1 % |
| AT6 | wearMult 3 vs 1 | same run | wear ratio 3 ± 1 % |
| AT7 | pressure opt, opt ± 10, opt + 40 | pressureFactor | 1, 0.98 (1 − 0.002·100/10), 0.9 (floor) |
| AT8 | wear never | any input | wear clamped to [0, 1], no NaN |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No imports from `three`/Rapier; no allocation in `updateTyreState`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Computing slip power from forces, per-wheel wiring into the vehicle, HUD display, compound selection.

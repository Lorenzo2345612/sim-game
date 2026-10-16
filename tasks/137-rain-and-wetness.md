# 137 — Rain and track wetness model, wet compounds

Status: pending
Phase: 2
Depends on: 058, 115
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure `TrackWeather` integrates track wetness from rain, `gripFactor` gives the grip multiplier per compound class, and `CarSpec` gains `inter` and `wet` compounds.

## Context

Design: `docs/plans/game-features.md` section 137. M2.2 compound/pit-service tasks build on this; this task only adds the data and the pure model, no pit, strategy or vehicle wiring. Current code: `src/physics/carSpec.ts` (`TyreName = 'soft'|'medium'|'hard'`, `TyreCompound` with `mu0, Fz0, loadSens, Bx..Ey, optTempC, tempWindowC, heatCoef, coolCoef, wearRate, wearGripLoss, cliffWear`, `parseCarSpec`, private helper `compound(root, path)`, `tyres.compounds: Record<TyreName, TyreCompound>`); cars in `public/cars/*.json` (f4, gt3-a..d, hyper-a, lmp2-a) have only soft/medium/hard. Slick = soft/medium/hard. `weather.ts` imports only types from `carSpec.ts`. `src/physics/tyreState.ts` already exports a different `gripFactor(c, s, p, opt)`; the new one lives in `weather.ts` and is imported by module path (alias `wetGripFactor` when both are needed). Applying it in `VehicleModel` (`src/physics/vehicleModel.ts`; `vehicle.ts` only re-exports it as `Vehicle`) is task 139; do not touch `vehicleModel.ts`, `tyreState.ts` or `trackConditions.ts` (214 wear/ambient multiplier stays independent of rain).

## Files

- `src/physics/weather.ts` — create
- `src/physics/carSpec.ts` — modify: `TyreName` gains `'inter' | 'wet'`; `parseCarSpec` fills them
- `tests/unit/physics/weather.test.ts` — create (edge cases)
- `tests/unit/acceptance/137-rain-and-wetness.test.ts` — create (acceptance worker)
- `tests/unit/acceptance/058-car-spec.test.ts` — planner-authorised edit: AT1 line 61 `Object.keys(spec.tyres.compounds).sort()` now expects `['hard', 'inter', 'medium', 'soft', 'wet']`. No other frozen test changes (213/072/113/214 read only soft/medium/hard).

## Steps

```ts
import type { TyreName } from './carSpec';
export type CompoundClass = 'slick' | 'inter' | 'wet';
export function compoundClass(name: TyreName): CompoundClass; // soft|medium|hard → 'slick'
export function gripFactor(cls: CompoundClass, wetness: number): number;
export function wearMultiplier(cls: CompoundClass, wetness: number): number; // 3 for inter/wet when wetness < 0.2, else 1
export class TrackWeather {
  constructor(seed: number);
  setRain(r: number): void;          // clamped to [0, 1]
  setWetness(w: number): void;       // clamped to [0, 1] (initial state and test hook)
  update(dt: number, lineUsage: number): void; // lineUsage = cars per minute on the racing line, clamped >= 0
  readonly wetness: number;          // [0, 1], starts 0
  readonly rain: number;
}
```

1. `update`: `wetness += dt · (0.02·rain − (rain < 0.05 ? 0.004·(1 + 0.1·lineUsage) : 0))`, then clamp to [0, 1] (forward Euler per call).
2. `gripFactor` (wetness clamped to [0, 1]): slick `1 − 0.45·w`; inter `0.93 − 0.15·|w − 0.5|·2`; wet `0.85 + 0.05·w`.
3. `parseCarSpec`: when `tyres.compounds.inter` / `.wet` are absent they are derived from `medium` (all fields copied, `mu0` × 0.93 / × 0.88); when present they are parsed with the existing `compound()` helper. Existing car JSONs need no edit. Fix type errors from the wider `TyreName` by narrowing, no behaviour change (settings `CompoundOption`, `COMPOUNDS` in `setupPanel.ts` and `hudTyres` stay `soft|medium|hard`).

Conventions: no rounding; `dt <= 0` or non-finite → no change; non-finite `rain`/`wetness` inputs ignored; `seed` stored, unused for now; drying applies only when `rain < 0.05` (strict).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rain 1 for 50 s from dry | wetness | 1.0 ± 1e-9 (clamped after 50 s) |
| AT2 | wet 1, rain 0, lineUsage 0 | after 100 s | 0.6 ± 1e-6 |
| AT3 | gripFactor slick/inter/wet at wetness 0, 0.5, 1 | call | slick 1/0.775/0.55; inter 0.78/0.93/0.78; wet 0.85/0.875/0.9 |
| AT4 | parseCarSpec f4.json | tyres | has inter and wet |

## Acceptance criteria

- [ ] All AT rows pass; edge tests pass (clamps, drying with line usage, derived compound values).
- [ ] `npm run typecheck` and the existing carSpec/vehicle tests pass unchanged (except the 058 AT1 edit above).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying grip/wear in `VehicleModel`, rain schedules, AI, HUD, visuals (tasks 138, 139).
- Pit-stop tyre changes and compound choice UI (M2.2), tuning real inter/wet curves.

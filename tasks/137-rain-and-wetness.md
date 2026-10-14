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

Design: `docs/plans/game-features.md` section 137. M2.2 compound/pit-service tasks will build on this; this task only adds the data and the pure model, no pit or strategy logic. `src/physics/carSpec.ts` (058: `TyreName = 'soft'|'medium'|'hard'`, `TyreCompound`, `parseCarSpec`, `tyres.compounds: Record<TyreName, TyreCompound>`). Slick = soft/medium/hard. `weather.ts` imports only types from `carSpec.ts`. Note `src/physics/tyreState.ts` already exports a different `gripFactor`; the new one lives in `weather.ts` and is imported by its module path. Applying it in `Vehicle` is task 139.

## Files

- `src/physics/weather.ts` — create
- `src/physics/carSpec.ts` — modify: `TyreName` gains `'inter' | 'wet'`; `parseCarSpec` fills them
- `tests/unit/physics/weather.test.ts` — create (edge cases)
- `tests/unit/acceptance/137-rain-and-wetness.test.ts` — create (acceptance worker)

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
3. `parseCarSpec`: when `tyres.compounds.inter` / `.wet` are absent they are derived from `medium` (all fields copied, `mu0` × 0.93 / × 0.88); when present they are parsed like the other compounds. Existing car JSONs need no edit. Fix any type error from the wider `TyreName` by narrowing, with no behaviour change (settings `compound` stays `soft|medium|hard`).

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
- [ ] `npm run typecheck` and the existing carSpec/vehicle tests pass unchanged.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying grip/wear in `Vehicle`, rain schedules, AI, HUD, visuals (tasks 138, 139).
- Pit-stop tyre changes and compound choice UI (M2.2), tuning real inter/wet curves.

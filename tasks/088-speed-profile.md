# 088 — Speed profile and car limits

Status: pending
Phase: 2
Depends on: 087, 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Compute the maximum feasible speed at each point of a racing line from simple car limits (friction circle, aero, power), and derive those limits from a `CarSpec`.

## Context

`src/ai` layer (imports `core`, `track` and the `CarSpec` type from `physics/carSpec` only (`import type`); no Rapier, no three). `RacingLine` comes from `src/ai/racingLine.ts` (087); curvature from its `mengerCurvature` on consecutive line points. `CarSpec` from `src/physics/carSpec.ts`. g = 9.81 m/s². Design: `docs/plans/phase2-race.md` section 088.

## Files

- `src/ai/speedProfile.ts` — create.
- `tests/unit/ai/speedProfile.test.ts` — create — edge cases.

## Steps

```ts
import type { CarSpec } from '../physics/carSpec';
import type { RacingLine } from './racingLine';
export interface CarLimits { muLat: number; muLong: number; aeroK: number /* 1/m: extra normal accel = aeroK·v² */; dragK: number /* 1/m: decel = dragK·v² */; powerPerMass: number /* W/kg */; vMax: number /* m/s */ }
export function cornerSpeed(kappa: number, lim: CarLimits): number;
export function speedProfile(line: RacingLine, lim: CarLimits): Float64Array; // m/s per point
export function carLimitsFromSpec(spec: CarSpec, fuelKg: number): CarLimits;
```

- `cornerSpeed = sqrt(muLat·g / (|κ| − muLat·aeroK))` when `|κ| > muLat·aeroK`, else `vMax`; result capped at `vMax`.
- Available longitudinal grip (friction circle): `a_g(v,κ) = muLong·(g + aeroK·v²)·sqrt(max(0, 1 − (v²|κ| / (muLat·(g + aeroK·v²)))²))`.
- Forward pass: `a = min(a_g, powerPerMass / max(v,1)) − dragK·v²`; `v₊² = v² + 2·a·ds`. Backward pass: `decel = a_g + dragK·v²`. Result = min(corner, forward, backward) per point. Closed loop: start both passes at the point of minimum corner speed and go around twice (second lap overwrites). `ds` = distance between consecutive points (closing segment included); κᵢ from points i−1, i, i+1 (wrapping).
- `carLimitsFromSpec` (fields of `CarSpec`: `chassis.massKg`, `aero.cda/claFront/claRear`, `engine.torqueCurve` as `[rpm, torqueNm][]`, `tyres.compounds.medium.mu0`): `m = massKg + fuelKg`; `muLat = muLong = 0.95·medium.mu0`; `aeroK = 0.5·1.225·(claFront + claRear)/m`; `dragK = 0.5·1.225·cda/m`; `powerPerMass = 0.9·Pmax/m` with `Pmax = max over torqueCurve of torque·rpm·2π/60`; `vMax` = cbrt(0.9·Pmax / (0.5·1.225·cda)).

Conventions: no rounding; `|κ|` exactly `muLat·aeroK` gives `vMax`; speeds clamped to `[0, vMax]` (never negative or NaN; `a_g` under the root clamped at 0); empty line or `line.points.length/2 < 3` throws `Error`; `fuelKg < 0` throws; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | κ 0.01, muLat 1.5, aeroK 0, vMax 100 | cornerSpeed | sqrt(1.5·9.81·100) = 38.361 ± 0.01 |
| AT2 | κ 0.01, muLat 1.5, aeroK 0.003 | cornerSpeed | sqrt(14.715/0.007) = 45.849 ± 0.01 |
| AT3 | κ 0.004, muLat 1.5, aeroK 0.003 | cornerSpeed | vMax |
| AT4 | circle R 100 line (087 AT1 fixture), muLat 1.5, aeroK 0, power high | speedProfile | all speeds = cornerSpeed(1/105) ± 0.5 % |
| AT5 | rounded square (087 AT2), limits muLat=muLong 1.6, aeroK 0.002, dragK 0.0004, powerPerMass 400, vMax 80 | speedProfile | min speed inside the arcs; for every consecutive pair, (v₁² − v₂²)/(2ds) ≤ a_g + dragK·v₁² + 1e-6 when braking and (v₂² − v₁²)/(2ds) ≤ min(a_g, P/max(v₁,1)) − dragK·v₁² + 1e-6 when accelerating; no speed above cornerSpeed(κᵢ) + 1e-9 |
| AT6 | public/cars/f4.json, fuel 0 | carLimitsFromSpec | all fields finite and > 0; vMax in [55, 85] m/s |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No `Math.random`, no import from `three`, `@dimforge`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- The driver controller and traffic (089, 090).
- Per-gear or per-corner tyre/temperature/wear models; slope (elevation) effects.
- Changing `CarSpec` or `public/cars/f4.json`.

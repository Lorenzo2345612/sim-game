# 059 — Tyre forces

Status: pending
Phase: 1
Depends on: 058
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure tyre force functions: magic formula, load-sensitive friction, combined slip via friction ellipse, slip-angle relaxation.

## Context

Guide: `ai/guides/vehicle-dynamics.md` ("Tyre model"; do not restate it). Types from `src/physics/carSpec.ts` (task 058). Reference: `ai/lab/vehicle-model.mjs`. No `three`, no Rapier.

## Files

- `src/physics/tyre.ts` — create.
- `tests/unit/acceptance/059-tyre-forces.test.ts` — create (acceptance worker).

## Steps

```ts
import type { TyreCompound } from './carSpec';
export const RELAX = 0.25;  // m
export const V_LOW = 1.5;   // m/s
export function magic(B: number, C: number, E: number, D: number, s: number): number;
export function tyreMu(c: TyreCompound, fz: number, factor: number): number;
export function tyreForces(c: TyreCompound, fz: number, kappa: number, alpha: number, factor: number, out: {fx:number; fy:number}): {fx:number; fy:number};
export function relaxAlpha(alpha: number, target: number, vx: number, dt: number): number;
```

- `magic`: D·sin(C·atan(B·s − E·(B·s − atan(B·s)))); odd in s.
- `tyreMu` = mu0·(1 − loadSens·(fz − Fz0)/Fz0)·factor. `factor` already includes surface, temperature, wear, pressure.
- `tyreForces`: pure Fx0 (Bx,Cx,Ex, D = mu·fz, s = kappa) and Fy0 (By,Cy,Ey, s = alpha), then friction ellipse: if (Fx0/D)² + (Fy0/D)² > 1 scale both by 1/sqrt of that sum. Writes into and returns `out` (no allocation). `fy` is the force for positive alpha; the caller negates for right-positive.
- `relaxAlpha` = alpha + (target − alpha)·(1 − exp(−dt·max(|vx|, V_LOW)/RELAX)).

Conventions: no rounding; fz ≤ 0 → fx = fy = 0 (no NaN, `-0` allowed as 0); kappa/alpha not clamped; `out` is mutated, other args are not; ellipse threshold is strict `> 1`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/059-tyre-forces.test.ts` before the coder starts. Nobody else may change these rows or tests. Compound used: f4.json `medium`.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | medium compound, fz = Fz0, factor 1 | kappa 0, alpha 0 | fx = 0, fy = 0 |
| AT2 | same | sweep kappa 0…0.5 | max fx ≤ mu0·Fz0 + 1e-6 and ≥ 0.98·mu0·Fz0; peak at kappa in [0.06, 0.16] |
| AT3 | same | kappa ±0.1 | fx(−0.1) = −fx(0.1) |
| AT4 | same | sweep alpha 0…0.4 rad | peak fy in [0.98, 1.0]·mu0·Fz0 at alpha in [0.10, 0.20] rad |
| AT5 | fz = 2·Fz0 | kappa at peak | peak fx = mu0·(1 − loadSens)·2·Fz0 ± 1 % |
| AT6 | kappa 0.1 and alpha 0.15 (both near peak) | combined | (fx/Dx)² + (fy/Dy)² ≤ 1 + 1e-9 and both nonzero |
| AT7 | factor 0.5 | any slip | forces exactly half of factor 1 (ellipse inactive case kappa 0.02, alpha 0) |
| AT8 | `relaxAlpha(0, 0.1, 60, 1/120)` | once | = 0.1·(1 − exp(−(1/120)·60/0.25)) ± 1e-12; with vx 0 uses V_LOW 1.5 |
| AT9 | fz 0 or negative | `tyreForces` | fx = fy = 0, no NaN |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No allocation inside `tyreForces`; no imports from `three`/Rapier.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Temperature/wear/pressure (060), wheel spin solver (064), surface grip lookup, any use of Rapier.

# 058 — CarSpec type, loader and F4 data

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Typed car definition with a validating loader, and the F4 data file, so later physics modules take all parameters from a `CarSpec`.

## Context

Guide: `ai/guides/vehicle-dynamics.md` ("Car definition", "Setups"). Source numbers: `ai/lab/f4-carspec.json`. Pure module: no `three`, no Rapier.

## Files

- `src/physics/carSpec.ts` — create — types and `parseCarSpec`.
- `public/cars/f4.json` — create — F4 data.
- `tests/unit/acceptance/058-car-spec.test.ts` — create (acceptance worker) — one test per AT row.

## Steps

1. Export from `carSpec.ts`: `type Vec3 = {x:number;y:number;z:number}`; `type SetupKey = 'frontWing'|'rearWing'|'brakeBias'|'finalDrive'|'arbFront'|'arbRear'|'rideHeight'|'tyrePressureKpa'`; `interface SetupRange { min:number; max:number; step:number; default:number }`; `type SetupRanges = Record<SetupKey, SetupRange>`; `interface TyreCompound` (fields exactly as the guide: `mu0,Fz0,loadSens,Bx,Cx,Ex,By,Cy,Ey,optTempC,tempWindowC,heatCoef,coolCoef,wearRate,wearGripLoss,cliffWear`); `interface CarSpec` with the sections listed in the guide, field names as in `ai/lab/f4-carspec.json`, plus `id`, `name`, `category: 'open-wheel'`, `model: {url:string}`, `engine.launchRpm`, `aero.rideHeightSens`, `aero.wingStep: {claFront:number; claRear:number; cda:number}`, `setup: SetupRanges`, `presets: Record<'stable'|'balanced'|'aggressive', Record<SetupKey, number>>`, `tyres.compounds: Record<'soft'|'medium'|'hard', TyreCompound>`, `tyres.pressureKpa: number` (current pressure; `parseCarSpec` defaults it to `tyres.optPressureKpa` when absent; task 067 `applySetup` writes it), `drive: 'rwd'`. `TyreCompound` is exported from here (other tasks import it from this file).
2. `parseCarSpec(json: unknown): CarSpec` — validates every required field (type number/string/array, finite); throws `Error` whose message contains the dotted path of the first missing/invalid field (e.g. `chassis.massKg`). `chassis.inertia` optional: when absent, computed with the box formula using full sizes (2·halfExtents): Ix = m(h²+d²)/12, Iy = m(w²+d²)/12, Iz = m(w²+h²)/12 (w,h,d = full x,y,z sizes). `wheels.inertia` defaults 1.2 when absent. Returns a new object; input not mutated.
3. `public/cars/f4.json`: lab file plus `id 'f4'`, `name 'F4'`, `category 'open-wheel'`, `model {url '/models/f4.glb'}`, `aero.wingStep {claFront 0.06, claRear 0.09, cda 0.015}`. Compounds: `medium` = lab values; `soft` = medium with mu0×1.06, wearRate×2, optTempC 85; `hard` = medium with mu0×0.95, wearRate×0.5, optTempC 95.
4. `setup` (min, max, step, default): frontWing 0,10,1,5; rearWing 0,10,1,5; brakeBias 0.50,0.70,0.01,0.60; finalDrive 3.2,3.8,0.05,3.5; arbFront 6000,40000,1000,18000; arbRear 6000,40000,1000,12000; rideHeight −0.02,0.02,0.002,0; tyrePressureKpa 120,160,1,140.
5. `presets`: stable {6,7,0.62,3.5,16000,14000,0.004,140}; balanced = all defaults; aggressive {4,3,0.58,3.4,22000,10000,−0.006,145} (order of SetupKey above).

Conventions: no rounding; validation is exact-type (no coercion of strings); invalid or missing field → throw `Error` (never clamp); NaN/Infinity invalid; input not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/058-car-spec.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `public/cars/f4.json` | `parseCarSpec` | returns; massKg 650, 4 wheel positions, compounds soft/medium/hard, 8 setup entries each with min < default < max (or min ≤ default ≤ max) |
| AT2 | f4 json without `chassis.massKg` | `parseCarSpec` | throws, message contains `chassis.massKg` |
| AT3 | f4 json without `chassis.inertia`, halfExtents {0.8, 0.2, 2.0}, mass 650 | parse | inertia.x = 650·(0.4²+4²)/12 ± 1e-6 (box: Ix = m·(h²+d²)/12 with full sizes) |
| AT4 | f4 json | compare with `ai/lab/f4-carspec.json` | every numeric field present in the lab file is equal |
| AT5 | each preset | values | every value within its setup range |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `carSpec.ts` imports nothing from `three` or Rapier.
- [ ] Typecheck and lint clean.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `applySetup`/`clampSetup` (task 067), tyre/engine math, loading over fetch, other cars.

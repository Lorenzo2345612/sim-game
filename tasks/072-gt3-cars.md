# 072 — GT3 car definitions

Status: pending
Phase: 1
Depends on: 058, 071
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Three GT3 `CarSpec` files (`gt3-a`, `gt3-b`, `gt3-c`) with identical dynamics and per-model geometry.

## Context

`CarSpec` and `parseCarSpec` come from `src/physics/carSpec.ts` (task 058; see `public/cars/f4.json` as format reference). Dynamics source: `ai/lab/gt3-carspec.json` (passes the lab). Geometry source: `public/models/<id>.json` (task 071). Ids and names are brand-neutral: "GT3 A/B/C". The only `src/` change allowed is the category union (step 3).

## Files

- `src/physics/carSpec.ts` — modify (category union only)
- `public/cars/gt3-a.json`, `gt3-b.json`, `gt3-c.json` — create
- `tests/unit/acceptance/072-gt3-cars.test.ts` — create (acceptance worker)

## Steps

1. Each file: all sections from `ai/lab/gt3-carspec.json` (engine, gearbox, aero, tyres, brakes, aids, fuel, chassis, mass 1300), plus `id`, `name` ("GT3 A"/"GT3 B"/"GT3 C"), `category: 'gt3'`, `model: { url: '/models/<id>.glb' }`, and the other fields F4 has that the lab file lacks (setup ranges, presets, compounds, `drive`), copied from the F4 shape with GT3-appropriate values only where the lab file provides them; otherwise copy F4 values.
2. Wheel positions from the model json: x and z of each hub; y = wheelRadius − cgHeight (cgHeight from the lab chassis); `wheels.radius` = model wheelRadius.
3. In `src/physics/carSpec.ts` widen `category` to `'open-wheel' | 'gt3' | 'gt4' | 'touring' | 'prototype'` (only change allowed in `src/`; `parseCarSpec` accepts these values).
4. Setup: the lab file stores wing steps as `claPerStep`/`cdaPerStep` inside `setup.frontWing`/`setup.rearWing`; map them to the 058 schema: `aero.wingStep = { claFront: frontWing.claPerStep, claRear: rearWing.claPerStep, cda: rearWing.cdaPerStep }` and drop those two fields from the ranges.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each file | `parseCarSpec` | ok; mass 1300; category 'gt3'; name matches /^GT3 [ABC]$/ |
| AT2 | each file vs its model json | wheel positions | x, z equal ± 1e-3; y = wheelRadius − cgHeight ± 1e-3 |
| AT3 | each file vs `ai/lab/gt3-carspec.json` | engine, gearbox, aero, tyres, brakes, aids, fuel | deep-equal |
| AT4 | repo | grep public/cars, src | no brand names (same list as 071 AT6) |

## Acceptance criteria

- [ ] AT1–AT4 pass; existing tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Selection UI (073), tuning of the dynamics, new setup ranges, changes to `src/`.

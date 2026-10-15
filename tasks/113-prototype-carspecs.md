# 113 — Prototype CarSpecs from the lab files

Status: pending
Phase: 1
Depends on: 112, 072, 058
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Two `CarSpec` files (`lmp2-a`, `hyper-a`; B variants are task 170) with class dynamics and per-model geometry.

## Context

Same procedure as `tasks/072-gt3-cars.md` (read it; its steps 1, 2 and 4 apply with the substitutions below). `CarSpec`/`parseCarSpec` come from `src/physics/carSpec.ts`; `public/cars/gt3-a.json` is the format reference. Dynamics sources (planner-calibrated): `ai/lab/lmp2-carspec.json` for `lmp2-*` (mass 950 kg), `ai/lab/hypercar-carspec.json` for `hyper-*` (mass 1030 kg). Geometry: `public/models/<id>.json` (112). Names brand-neutral: "LMP2 A", "Hypercar A". The only `src/` change allowed is the category union.

## Files

- `src/physics/carSpec.ts` — modify: add `'lmp2' | 'hypercar'` to `CarCategory` and to the runtime `CATEGORIES` list (keep existing values)
- `public/cars/{lmp2-a,hyper-a}.json` — create
- `tests/unit/acceptance/113-prototype-carspecs.test.ts` — create (acceptance worker)

## Steps

1. Each file: sections engine, gearbox, aero, tyres, brakes, aids, fuel, chassis, mass from its lab file, plus `id`, `name`, `category` (`'lmp2'` for lmp2-*, `'hypercar'` for hyper-*), `model: { url: '/models/<id>.glb' }`, and the remaining F4/GT3 fields (setup ranges, presets, compounds, `drive`) copied from `public/cars/gt3-a.json` unless the lab file provides them.
2. Wheel positions from the model json (x, z of each hub); y = wheelRadius − cgHeight (cgHeight from the lab chassis); `wheels.radius` = model wheelRadius.
3. Wing step mapping as in 072 step 4 when the lab file uses `claPerStep`/`cdaPerStep`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each of lmp2-a, hyper-a | `parseCarSpec` | ok; category 'lmp2' / 'hypercar'; names "LMP2 A", "Hypercar A" |
| AT2 | each file vs its model json | wheel positions | x, z equal ± 1e-3; y = wheelRadius − cgHeight ± 1e-3 |
| AT3 | lmp2-* vs `ai/lab/lmp2-carspec.json`, hyper-* vs `ai/lab/hypercar-carspec.json` | engine, gearbox, aero, tyres, brakes, aids, fuel, mass | deep-equal |
| AT4 | repo | grep public/cars, src | no brand names |

## Acceptance criteria

- [ ] AT1–AT4 pass; existing tests (incl. 058, 072) pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Selection UI and credits (114), tuning the dynamics, new setup ranges, edits to `ai/lab/`, any other `src/` change.

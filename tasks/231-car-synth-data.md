# 231 — Per-car engine synth data

Status: pending
Phase: 1
Depends on: 226
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Every car JSON carries a `sound.synth` block with its own engine character (firing order, pipes, muffling, turbo, whine), so no two cars sound alike.

## Context

Design: `docs/design/engine-audio-v2.md`. Schema and ranges: task 226 (`EngineSynthSpec`, `parseEngineSynth`, `evenFiring` in `src/audio/soundSpec.ts`; `parseCarSpec` already validates `sound.synth`). Rationale per engine: `docs/research/engine-audio/na-engines.md` §2-§7 and `turbo-hybrid.md` §1-§4. Only fields listed below are written; omitted fields take defaults. Do not add brand names anywhere.

## Files

- `public/cars/{f4,gt3-a,gt3-b,gt3-c,gt3-d,lmp2-a,hyper-a,ow26}.json` — modify: add `sound.synth`; gt3-d also `sound.cylinders` 8 → 10 (sound only). Leave all other keys untouched.
- `tests/unit/acceptance/231-car-synth-data.test.ts` — create (from the table).
- Frozen-test edit (planner-authorised): `tests/unit/physics/carSoundSpec.test.ts`, test "every car JSON carries its sound data": the `gt3-d.json` row `[8, 1.4, 0.25, 0.5]` → `[10, 1.4, 0.25, 0.5]`; if `soundOf(json)` now returns a `synth` key, compare only the four legacy fields.

## Steps

Values per car (`E8` = `evenFiring(8)` values written out literally; `alt` = bank alternating 0,1,…; ms in m). Unlisted fields: defaults.

| Car | firingDeg / bank | pipeM / tailM | pulseDeg | intakeHz | lowpassHz | limiterHz | gainDb | extras |
|---|---|---|---|---|---|---|---|---|
| f4 | evenFiring(4) / alt | [0.5,0.5] / 0.5 | 130 | 350 | 5000 | 15 | 0 | turbo {centerHz 3000, spanHz 3000, gain 0.04, lagS 0.3} |
| gt3-a | E8 / [0,1,0,0,1,1,1,0] | [0.7,0.7] / 0.7 | 110 | 250 | 6000 | 14 | 0 | jitterAmp 0.12 |
| gt3-b | evenFiring(6) / alt | [0.55,0.65] / 0.55 | 100 | 400 | 7000 | 17 | 0 | — |
| gt3-c | E8 / alt | [0.75,0.75] / 0.75 | 90 | 250 | 8000 | 14 | 1 | jitterAmp 0.08 |
| gt3-d | [0,90,144,234,288,378,432,522,576,666] / alt | [0.55,0.55] / 0.55 | 85 | 300 | 8000 | 16 | 0 | jitterAmp 0.08 |
| lmp2-a | E8 / alt | [0.55,0.55] / 0.6 | 70 | 600 | 12000 | 22 | 3 | block [{hz 2800, q 3, gainDb 4}] |
| hyper-a | E8 / alt | [0.8,0.8] / 1.2 | 130 | 250 | 3500 | 15 | -1 | turbo {centerHz 3750, spanHz 3500, gain 0.03, lagS 0.5}; whine {order 14, gain 0.04, source "wheel", minSpeedMs 33} |
| ow26 | [0,90,240,330,480,570] / alt | [0.5,0.5] / 0.6 | 140 | 300 | 3000 | 20 | 1.5 | turbo {centerHz 4250, spanHz 2500, gain 0.02, lagS 0.45}; whine {order 18, gain 0.05, source "rpm", minSpeedMs 14} |

Key order inside `synth`: as in the columns. `turbo`/`whine` absent for cars without them (parser default null). No two `sound.synth` objects may be deep-equal.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each `public/cars/*.json` except index | `parseEngineSynth(sound.synth, sound)` | errors `[]`; `sound.synth` present in the file |
| AT2 | f4 / gt3-b / gt3-c / lmp2-a / hyper-a | firingDeg | `evenFiring(4)` / `evenFiring(6)` / `evenFiring(8)` / `evenFiring(8)` / `evenFiring(8)` |
| AT3 | gt3-a | firingDeg, bank | firingDeg `evenFiring(8)`; bank `[0,1,0,0,1,1,1,0]` (cross-plane, order 1-8-4-3-6-5-7-2) |
| AT4 | gt3-d | firingDeg | 10 values, consecutive intervals alternate 90 and 54 (± 0.5), first 0 |
| AT5 | ow26 | firingDeg | `[0,90,240,330,480,570]` |
| AT6 | all cars | turbo / whine | turbo non-null exactly for f4, hyper-a, ow26; whine source `'rpm'` for ow26, `'wheel'` for hyper-a, null for others |
| AT7 | all cars | pairwise | no two `sound.synth` objects deep-equal |
| AT8 | — | 221 acceptance tests, 226 tests | pass |

## Acceptance criteria

- [ ] All AT rows pass; every car loads through `parseCarSpec` with `sound.synth.firingDeg.length === sound.cylinders`.
- [ ] `git diff` on the car JSONs touches only `sound` blocks.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Changing any other car field (limiter, torque, idle), engine voice code, new cars, `index.json`, brand names.

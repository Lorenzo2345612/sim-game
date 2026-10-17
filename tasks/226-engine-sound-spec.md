# 226 — Engine sound spec types, parser and CarSound.synth

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`CarSound` carries a validated `synth: EngineSynthSpec` (firing order, pipes, layers) derived from legacy fields when a car json has no `sound.synth`.

## Context

Design: `docs/design/engine-audio-v2.md` (Contracts, Ranges, Legacy mapping: implement exactly). Research: `docs/research/engine-audio/na-engines.md`. Pure TypeScript, no `three`, no DOM. `src/audio/soundSpec.ts` must import nothing (carSpec imports it; no cycles). Layer gap: architecture.md does not list `audio`; physics importing the pure `audio/soundSpec` is planner-authorised.

## Files

- `src/audio/soundSpec.ts` — create — exports exactly the types and functions of the design Contracts section (`BlockMode`, `TurboLayer`, `WhineLayer`, `EngineSynthSpec`, `SYNTH_DEFAULTS`, `evenFiring`, `legacySynthSpec`, `parseEngineSynth`).
- `src/physics/carSpec.ts` — modify — `CarSound` gains `synth: EngineSynthSpec` (import type from `../audio/soundSpec`); `DEFAULT_CAR_SOUND.synth = legacySynthSpec({cylinders:4, exhaustLengthM:1.2, intakeMix:0.3, crackle:0.2})`; `carSound()` returns `synth` from `parseEngineSynth(pick(root,'sound.synth'), {cylinders, exhaustLengthM, intakeMix, crackle})`; if errors is non-empty throw `Error('Invalid car spec: sound.' + errors[0])`.
- Frozen tests, planner-authorised edits (add `synth`, nothing else):
  - `tests/unit/physics/carSoundSpec.test.ts`: the three literal `toEqual({cylinders,...})` (lines ~30, ~36, ~42) gain `synth: legacySynthSpec({cylinders, exhaustLengthM, intakeMix, crackle})` with the same four values; import `legacySynthSpec`.
  - `tests/unit/audio/engineAudioFallback.test.ts:149`, `tests/unit/audio/effects.test.ts:129` and `:259`, `tests/unit/edge/110-audio-effects.post.test.ts:147`, `tests/unit/edge/109-engine-worklet.test.ts:233`, `tests/unit/edge/109-engine-worklet.post.test.ts:224`: each `CarSound` literal gains `synth: legacySynthSpec({cylinders, exhaustLengthM, intakeMix, crackle})` of its own four values.

## Steps

1. Ranges, defaults and legacy mapping as in the design. `parseEngineSynth` never throws; each error string starts with `synth.<field>` (nested: `synth.turbo.gain` etc.). On any error still return a `spec` (invalid fields replaced by legacy/default values).
2. Parsing is plain validation (no schema library). `SYNTH_DEFAULTS` values per the ranges list defaults.
3. Returned specs are fresh objects (deep copies of arrays/objects), never shared with `SYNTH_DEFAULTS` or the input.

Conventions: range bounds inclusive except `pipeM`/`tailM` (lower bound exclusive) and `firingDeg` (upper bound 720 exclusive), `whine.order` (0 exclusive); non-finite or wrong-type number is an error; `raw` null/undefined/non-object (not {}) → treated as absent, no error; raw not mutated; `evenFiring(n)` returns `720·i/n` for i<n.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | — | `evenFiring(8)`, `evenFiring(6)` | `[0,90,180,270,360,450,540,630]`; `[0,120,240,360,480,600]` |
| AT2 | `{cylinders:4, exhaustLengthM:1.0, intakeMix:0.35, crackle:0.1}` | `legacySynthSpec` | firingDeg `[0,180,360,540]`, bank `[0,1,0,1]`, pipeM `[0.5,0.5]`, tailM 0.5, intakeMix 0.35, crackle 0.1, turbo null, whine null, every other field = `SYNTH_DEFAULTS` |
| AT3 | a full valid raw object with every field set to a non-default in-range value | `parseEngineSynth(raw, legacy)` | errors `[]`; spec deep-equals the input |
| AT4 | raw `{}` with legacy `{cylinders:6, exhaustLengthM:1.2, intakeMix:0.3, crackle:0.2}` | parse | errors `[]`; spec deep-equals `legacySynthSpec(legacy)`; `SYNTH_DEFAULTS` has gasSpeedMs 480, pulseDeg 110, jitterDeg 0.2, jitterAmp 0.05, intakeHz 300, block `[]`, lowpassHz 6000, drive 1.2, turbo null, whine null, limiterHz 15, gainDb 0 |
| AT5 | raws: firingDeg `[0,720]`; bank length ≠ firingDeg length; pipeM `[0,1]`; 7 block modes; whine source `'x'`; turbo gain 0.5 | parse each | each has ≥ 1 error containing respectively `synth.firingDeg`, `synth.bank`, `synth.pipeM`, `synth.block`, `synth.whine`, `synth.turbo`; never throws |
| AT6 | every `public/cars/*.json` except `index.json` | `parseCarSpec` (existing loader) | no throw; `sound.synth.firingDeg.length === sound.cylinders` |
| AT7 | a valid car json with `sound.synth.firingDeg: [0, 800]` | `parseCarSpec` | throws; message contains `sound.synth.firingDeg` |

## Acceptance criteria

- [ ] All AT rows pass; existing car json files parse unchanged.
- [ ] Edited frozen tests only differ by the added `synth` fields.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Editing any `public/cars/*.json` (task 231), any worklet/voice code, `engineSynth.ts`.

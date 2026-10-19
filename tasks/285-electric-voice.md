# 285 — Electric voice (multi-layer whine, inverter carrier)

Status: pending
Phase: 7
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

An electric synth kind: several wheel/rpm-locked whine layers plus a fixed inverter carrier tone, with no firing, exhaust or idle sound.

## Context

Design: `docs/design/m7.1-electric.md`. Existing: `EngineSynthSpec` and `parseEngineSynth(raw, legacy)` in `src/audio/soundSpec.ts` (single `whine: WhineLayer | null`; errors are strings pushed to `errors`, style `synth.whine.order must be ...`); rendering in `src/audio/engineVoice.ts` (whine at ~L770 uses `WHEEL_RADIUS_M = 0.33`). Combustion voices must render bit-identically.

## Files

- `src/audio/soundSpec.ts` — modify
- `src/audio/engineVoice.ts` — modify
- `tests/unit/acceptance/285-electric-voice.test.ts` — create (from the table)

## Steps

```ts
// EngineSynthSpec gains:
kind: 'combustion' | 'electric';              // default 'combustion'
electric: { layers: { order: number; gain: number; source: 'wheel' | 'rpm' }[]; carrierHz: number; carrierGain: number } | null;
```
1. Input `synth.kind` ('combustion' | 'electric'; anything else is an error `synth.kind must be 'combustion' or 'electric'`). For `electric`, input `synth.electric` is required with: `layers` array of 1..4 entries, `order` in (0, 400], `gain` in [0, 0.3], `source` 'wheel' or 'rpm'; `carrierHz` in [4000, 16000]; `carrierGain` in [0, 0.1]. Each violation adds one error string prefixed `synth.electric.`. When kind is electric the firing/exhaust/turbo/whine fields are still parsed with their defaults but ignored when rendering; the legacy `cylinders` fallback stays supplied by the caller.
2. Render (electric): sum of layers, each a sine at `order·wheelSpeedMs/(2π·WHEEL_RADIUS_M)` Hz (source 'wheel') or `order·rpm/60` Hz (source 'rpm'), amplitude `gain·` (existing whine level scaling by throttle/speed), phase-continuous across blocks; plus a constant sine at `carrierHz` with amplitude `carrierGain`. No exhaust, intake, firing pulses, idle or limiter.
3. At `wheelSpeedMs` 0 and throttle 0 the layer terms are silent (RMS of everything below `carrierHz`−500 Hz < 1e-3); only the carrier remains.
4. Existing car specs (no `kind`) parse to `kind: 'combustion'`, `electric: null`, other fields unchanged.

Conventions: errors accumulate (one per violation, no throw); range bounds inclusive except `order` > 0; no mutation of input; no per-sample allocation in render.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | electric spec layers [{31, 0.2, wheel}], carrier 10000 / 0.05 | parse | ok, no errors |
| AT2 | order 500 / 5 layers / carrierHz 20000 | parse | each reported in `errors` |
| AT3 | AT1 voice, wheelSpeedMs 50, 0.5 s at 48 kHz | render + FFT | peak within ±10 Hz of 747.5 Hz; a peak at 10 000 ± 50 Hz |
| AT4 | wheelSpeedMs 0, throttle 0 | render 0.2 s | RMS of the whine band < 1e-3 (silent at rest except carrier ≤ carrierGain) |
| AT5 | all existing car voices | parse/render tests | unchanged |

## Acceptance criteria

- [ ] All ATs pass; existing audio tests (226, 231, 239, 244 families) pass without edits.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `eow.json` voice data (286), regen/brake sounds, tyre sounds, Doppler/spatialisation, UI.

## Planner answers (round 1)

Planner-authorised edit: in `tests/unit/acceptance/226-engine-sound-spec.test.ts` add `kind: 'combustion'` and `electric: null` to `FULL_RAW` (lines 15–37) so AT3's `toEqual` matches the parsed spec. Nothing else in 226. Keep `kind`/`electric` as own enumerable fields (structured clone in `engineAudio.ts`).

## Planner answers (round 2)

- Planner-authorised: in `tests/unit/edge/285-electric-voice-edge.test.ts` EDGE10 change the expected `bandRms(9900, 10100)` from `0.05/√2` to `0.05/2` (0.025; the helper measures A/2 for a pure sine), same relative tolerance. Nothing else in that file; the carrier stays a sine of amplitude `carrierGain`.
- 249/250 failures: not this task's concern if they fail on master too (`git stash`-free check: run them in the main repo). Do not touch track code.

# 229 — Wire EngineVoice into the worklet, EngineAudio and main

Status: pending
Phase: 1
Depends on: 228
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

The in-game engine sound uses `EngineVoice` (per-car `synth`) driven by rpm, engine load, throttle, wheel speed and limiter state.

## Context

Design `docs/design/engine-audio-v2.md`; research `docs/research/engine-audio/drivetrain-mix.md`. Oscillator fallback and the existing 110 crackle one-shots stay for the non-worklet path. Existing worklet test harnesses mock `AudioWorkletProcessor`, `registerProcessor`, `sampleRate` as globals.

## Files

- `src/audio/engineWorklet.ts` — modify — imports only `./engineVoice` and `./soundSpec`. `export interface EngineProcessorOptions { synth: EngineSynthSpec; seed: number }`. Processor name stays `engine-synth`. Port message `{rpm, load, throttle, wheelSpeedMs, limiter}`: each field applied only if it has the right type (number / boolean); if `load` is absent it follows `throttle`. Missing `processorOptions` → `legacySynthSpec({cylinders:4, exhaustLengthM:1.2, intakeMix:0.3, crackle:0.2})`, seed 1. Each `process` calls `voice.setControl` then `voice.render(out[0])`; returns true.
- `src/audio/engineAudio.ts` — modify — `update(rpm, throttle, slipRatios, extra?: { load?: number; wheelSpeedMs?: number })`. Posted message: `{rpm, load: extra?.load ?? throttle, throttle, wheelSpeedMs: extra?.wheelSpeedMs ?? 0, limiter: rpm >= limiterRpm - 50}`. `rebuildWorklet` passes `processorOptions: { synth: this.sound.synth, seed: WORKLET_SEED }`. While the worklet node exists, `crackleSchedule` one-shots are not scheduled (the voice makes pops); otherwise unchanged.
- `src/main.ts` — modify — the `engineAudio?.update(` call passes a 4th argument `{ load, wheelSpeedMs }`: `wheelSpeedMs = Math.abs(interp.forwardSpeed)`; `load = clamp(engineTorque(baseSpec.engine, rpm, simInput.throttle) / engineTorque(baseSpec.engine, rpm, 1), 0, 1)`, 0 if the denominator ≤ 0 (`engineTorque` from `./physics/powertrain`).
- Frozen tests, planner-authorised edits:
  - `tests/unit/edge/109-engine-worklet.post.test.ts`: POST1 expected imports → `['./engineVoice', './soundSpec']`; POST9 line ~352 `processorOptions?.cylinders` toBe 8 → `(processorOptions?.synth as {firingDeg:number[]}).firingDeg.length` toBe 8; POST13/14/15 literal `processorOptions` → `{ synth: legacySynthSpec({cylinders:4, exhaustLengthM:1.2, intakeMix:0.3, crackle:0.2}), seed: 1 }`; POST14/15 "output non-zero" checks render 40 consecutive blocks and inspect the last block (POST14 compares the last blocks of both processors).
  - `tests/unit/edge/109-engine-worklet.test.ts`: EDGE6 replaces the `cylinders/exhaustLengthM/intakeMix` asserts with `synth.firingDeg.length === 8`, `synth.pipeM[0]` ≈ 0.7, `synth.intakeMix` ≈ 0.25 and finite `seed`; EDGE9 literal options as above, renders 40 blocks, asserts finite, |x| ≤ 1, last block non-zero.
  - `tests/unit/audio/engineAudioFallback.test.ts`: line ~209 and ~228 `processorOptions?.cylinders` toBe 8 → `synth.firingDeg.length` toBe 8; line ~210 expected message → `{ rpm: 6000, load: 0.7, throttle: 0.7, wheelSpeedMs: 0, limiter: false }`.

## Steps

1. Implement as in Files. Do not change `getStats`, gains, mixer wiring or the oscillator path.
2. `limiterRpm` default is `LIMITER_RPM` (9000); threshold inclusive.

Conventions: non-finite `extra` values → fallback (load → throttle, wheelSpeedMs → 0); load clamped [0,1], wheelSpeedMs ≥ 0; no mutation of arguments.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | worklet processor (globals mocked as in 109 tests) with processorOptions `{synth: legacySynthSpec(gt3-a sound), seed: 3}` | message `{rpm:5000, load:1, throttle:1, wheelSpeedMs:0, limiter:false}`, 400 × `process` (128 frames) | last 100 blocks RMS > 0.01, no NaN |
| AT2 | EngineAudio with ready worklet (fake ctx) | `update(6000, 0.8, [], {load:0.6, wheelSpeedMs:40})` | last posted message deep-equals `{rpm:6000, load:0.6, throttle:0.8, wheelSpeedMs:40, limiter:false}` |
| AT3 | same | `update(6000, 0.8, [])` | message has load 0.8, wheelSpeedMs 0 |
| AT4 | limiterRpm 9000 | `update(8960, 1, [])` / `update(8940, 1, [])` | limiter true / false |
| AT5 | worklet ready, rpm 8500 throttle 1 → update with throttle 0 | — | no crackle buffer source is scheduled (pops come from the voice); with worklet failed, existing 110 crackle behaviour unchanged |
| AT6 | worklet ready | `setSound(sound)` with a different synth | a new AudioWorkletNode is created with `processorOptions.synth` deep-equal `sound.synth`; the old node is disconnected |
| AT7 | `src/main.ts` source | read | `engineAudio?.update(` call passes a 4th argument with `load` computed from `engineTorque` and `wheelSpeedMs` |

## Acceptance criteria

- [ ] All AT rows pass; edited frozen tests pass with only the listed changes.
- [ ] `src/audio/engineSynth.ts` unchanged; `npm run build` succeeds (worklet bundle).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- New engine DSP, per-car synth data (231), mixer (230), render tool (232), e2e changes.

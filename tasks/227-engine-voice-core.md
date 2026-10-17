# 227 — EngineVoice core: pulse train, exhaust tubes, DC block, soft clip, slew

Status: pending
Phase: 1
Depends on: 226
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`EngineVoice` renders a mono engine signal driven by firing order, load and rpm, with no layers yet (intake/block/turbo/whine/limiter/crackle are task 228).

## Context

Design `docs/design/engine-audio-v2.md` (Contracts, "Voice rules (227)"): implement those rules exactly. Causes of the old sound and technique rationale: `docs/research/engine-audio/techniques.md` §1, `drivetrain-mix.md`. Pure TypeScript, no `three`, no Web Audio globals (runs in Node). Per-sample loop must not allocate (preallocate all buffers in the constructor). Seeded PRNG (mulberry32) only; never `Math.random`.

## Files

- `src/audio/engineVoice.ts` — create — exports exactly: `VoiceControl`, `RPM_SLEW_S = 0.02`, `LOAD_SLEW_S = 0.03`, `WHEEL_RADIUS_M = 0.33`, class `EngineVoice` with `constructor(spec: EngineSynthSpec, sampleRate: number, seed: number)`, `setControl(c: VoiceControl): void`, `render(out: Float32Array): void`, `reset(): void` (signatures per the design). `EngineSynthSpec` is imported from `./soundSpec`.
- `src/audio/engineSynth.ts` — DO NOT modify.

## Steps

1. Implement the 227 voice rules: crank angle (720° cycle), per-cylinder firing crossing with seeded gaussian jitter, amplitude `(0.25 + 0.75·load)·(1 + jitterAmp·n)`, band-limited kernel table written at the fractional position, pulse width `pulseDeg` at current rpm clamped to [0.3, 8] ms, per-bank fractional-delay tube (linear/Lagrange interpolation, reflection −0.85, one-pole low-pass in loop), bank sum into tail tube, first-difference radiation, DC blocker, 2× oversampled asymmetric soft clip driven by `spec.drive`, final scale `gainDb` with hard peak ≤ 0.9.
2. `setControl` stores targets; rpm and load are smoothed per sample by one-pole filters with the slew constants; `throttle`, `wheelSpeedMs`, `limiter` are stored for 228 and ignored here. Initial state: rpm 0, load 0, crank angle 0; rpm 0 advances nothing and outputs silence.
3. Layer fields of the spec (intakeMix, block, turbo, whine, crackle, lowpassHz, limiterHz) are ignored in this task.
4. `reset()` returns the voice to its constructed state (same seed sequence restarts).

Conventions: rpm < 0 or non-finite → 0; load clamped to [0,1]; sampleRate ≤ 0 throws; `render` with empty array is a no-op; `out` is overwritten (not mixed); two voices with same spec/seed/control sequence produce bit-identical output.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 8 cyl even, rpm 6000, load 1 | render 1 s | no NaN/Inf; |mean| < 1e-3; max |x| ≤ 0.9; RMS > 0.01 |
| AT2 | same | normalised autocorrelation over lags 0.5-20 ms | smallest lag with value ≥ 0.9 × the max over that range is 2.5 ms ± 2 samples |
| AT3 | 4 cyl, rpm 6000, load 1; A firingDeg `[0,180,360,540]`, B `[0,90,360,450]` (bank `[0,1,0,1]`) | energy in bins 100/300/500/700 Hz ± 3 Hz vs 200/400/600/800 Hz ± 3 Hz | ratio < 0.05 for A; > 0.2 for B |
| AT4 | 8 cyl even, rpm 6000, load 1; pipeM `[0.5,0.5]` vs `[0.5,0.9]` | 1/3-octave band levels 100-4000 Hz | max |difference| ≥ 3 dB |
| AT5 | 8 cyl even, rpm 6000; load 1 vs load 0.1 | RMS | RMS(load 1) ≥ 1.8 × RMS(load 0.1) |
| AT6 | 8 cyl even, load 1; rpm 3000 for 0.5 s, then setControl rpm 9000 | render 0.5 s more in 128-sample blocks | max |x[n]−x[n−1]| during the 0.2 s after the step ≤ 2 × the same max over a steady 9000 rpm second; autocorrelation (AT2 method) of the last 0.25 s gives 1/600 s ± 1 % |
| AT7 | 6 cyl even, rpm 15000, load 1 | spectrum | energy above 20 kHz < −40 dB relative to total |
| AT8 | rpm 6000 load 1 for 0.5 s, then rpm 0 load 0 | render 0.5 s | RMS of the last 0.2 s < 1e-4 |
| AT9 | jitterDeg 0.2, jitterAmp 0.05 | two voices same seed vs seeds 1 and 2, 0.5 s | same seed identical arrays; different seeds differ |
| AT10 | — | 108 acceptance and edge tests | pass; `src/audio/engineSynth.ts` unchanged |

## Acceptance criteria

- [ ] All AT rows pass; `git diff --stat src/audio/engineSynth.ts` is empty.
- [ ] `render` performs no allocation (no `new`, array literals, closures inside the sample loop).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Layers (task 228), worklet/EngineAudio wiring (229), per-car data (231), mixer, any change to `engineSynth.ts`.

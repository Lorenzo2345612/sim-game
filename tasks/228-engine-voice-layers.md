# 228 — EngineVoice layers: intake, block, muffling, turbo, whine, limiter, crackle

Status: pending
Phase: 1
Depends on: 227
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`EngineVoice` honours the spec's layer fields (intake, block modes, muffling low-pass, turbo, gear whine, limiter cut, overrun crackle) using the `VoiceControl` fields stored by 227.

## Context

Design `docs/design/engine-audio-v2.md`, section "Layers (228)": implement those rules exactly. Research: `docs/research/engine-audio/turbo-hybrid.md`, `drivetrain-mix.md`, `na-engines.md`. Same constraints as 227 (pure TS, seeded PRNG, no allocation in the sample loop). Interpretation fixed here: crackle arms when throttle < 0.05 and rpm > 4000, fires for 1 s after the lift, never while throttle ≥ 0.05; pops are extra pulses (amplitude 0.6–1.0 of full pulse, drawn from the seeded PRNG) injected into the bank tubes; "boost" is load low-passed with time constant `turbo.lagS` (lagS 0 → boost = load).

## Files

- `src/audio/engineVoice.ts` — modify — add the layers inside `EngineVoice`; exported names and signatures unchanged.
- `src/audio/engineSynth.ts` — DO NOT modify.

## Steps

1. Intake, block (parallel band-pass resonators, RBJ biquads with `q`, linear gain from `gainDb`, driven by the pulse train, added to the exhaust path before the soft clip), `lowpassHz` 2-pole (Butterworth Q 0.707) on the exhaust before the soft clip, turbo, whine, limiter, crackle: as in the design layer rules.
2. Layers with an empty/null/zero setting (`block []`, `turbo null`, `whine null`, `intakeMix 0`, `crackle 0`) must add nothing; with `lowpassHz 20000` and no layers the output must stay bit-identical to the 227 behaviour.
3. Limiter: when `limiter` is true, ignition pulses are muted during the second half of each `1/limiterHz` period (50 % duty); tubes keep ringing.
4. Whine `wheel` source: silent when `wheelSpeedMs < minSpeedMs`; frequency from `wheelSpeedMs` slewed like rpm (`RPM_SLEW_S`).
5. Final peak limiting stays ≤ 0.9.

Conventions: whine/turbo gains in linear amplitude before master `gainDb`; band-pass `gainDb` clamped by spec range, no extra clamping; throttle clamped to [0,1]; `wheelSpeedMs` negative → 0.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rpm 6000, load 1, throttle 1, intakeHz 300; intakeMix 0 vs 1 | band 212-424 Hz energy | +≥ 6 dB with intakeMix 1 |
| AT2 | block `[]` vs `[{hz:900,q:8,gainDb:12}]` | 1/3-octave band at 900 Hz | +≥ 4 dB |
| AT3 | lowpassHz 12000 vs 1500 | energy above 4 kHz | ≥ 12 dB lower with 1500 |
| AT4 | turbo `{centerHz:3000, spanHz:3000, gain:0.05, lagS:0.4}` vs null; rpm 7000, load 1 for 2 s | band 3-6 kHz over the last second | +≥ 6 dB with turbo |
| AT5 | same turbo; load 0 for 1 s, then load 1 | band 3-6 kHz energy in the first 0.1 s after the step vs 1.4-1.5 s after | first < 50 % of later |
| AT6 | whine `{order:18, gain:0.05, source:'rpm', minSpeedMs:0}`, rpm 10000 | spectrum | peak at 3000 Hz ± 5 Hz ≥ 20 dB above the median level of 2.5-3.5 kHz |
| AT7 | whine `{order:14, gain:0.05, source:'wheel', minSpeedMs:33}`; wheelSpeedMs 20 vs 60 | level at `14·v/(2π·0.33)` Hz ± 5 Hz vs median of ±500 Hz | < 6 dB above median at 20; ≥ 20 dB at 60 |
| AT8 | limiter true, limiterHz 15, rpm 8000, load 1 | RMS envelope in 5 ms windows over 1 s | envelope autocorrelation peak at 1/15 s ± 10 %; dips ≥ 6 dB below peaks |
| AT9 | crackle 1 vs 0; rpm 8000, throttle 1 → 0 and load 1 → 0 | 1 s after lift: count clusters (≥ 2 ms apart) with |x| > 3 × RMS of the preceding 50 ms | ≥ 3 with crackle 1; 0 with crackle 0; 0 with crackle 1 while throttle stays 1 |
| AT10 | — | all 227 acceptance tests | pass |

## Acceptance criteria

- [ ] All AT rows pass, including all 227 acceptance tests; `engineSynth.ts` unchanged.
- [ ] No allocation inside `render`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Worklet/EngineAudio/main wiring (229), per-car synth data (231), mixer (230), offline render tool (232).

## Planner-authorised test edits

- `tests/unit/acceptance/228-engine-voice-layers.test.ts` AT7 at 20 m/s: instead of `< 6 dB above median`, assert the 20 m/s render is bit-identical to the same render with `whine: null`.
- `tests/unit/edge/227-engine-voice-core-edge.test.ts` EDGE7 (limiter ignored) and EDGE8 (layer fields ignored): delete both.

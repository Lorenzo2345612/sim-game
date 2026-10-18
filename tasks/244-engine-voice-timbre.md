# 244 — Engine voice timbre v2.1 (approved preview)

Status: pending
Phase: 1
Depends on: 228, 231
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`EngineVoice` gets the user-approved "H5" timbre (new kernel, tubes, per-cylinder traits, bass shelf, exhaust gain, new pop model) and every car's `sound.synth` is retuned to match.

## Context

Design `docs/design/engine-audio-v2.md`, section "244 — Voice timbre v2.1": implement its 6 core changes, spec fields and data list exactly. Builds on the merged 227 core and 228 layers code. Reference prototype (read for exact maths, not production code): `docs/design/engine-audio-ref/voice-h5.ts` (core) and `docs/design/engine-audio-ref/render-h5.ts` (layers, run with `NAME=H5 PIPE_K=1.5 CYLVAR=0.28 BASS_DB=8 BASS_HZ=160 POPW=1.8`). Research: `docs/research/engine-audio/pops-turbo-muffling.md`. Same constraints as 227 (pure TS, seeded `mulberry32`, no allocation in `render`).

## Files

- `src/audio/engineVoice.ts` — modify — export `PULSE_KERNEL: Float64Array` (length `KERNEL_N + 2`), `REFLECTION` (−0.25), `LOOP_LP_HZ` (1800); add per-cylinder traits, runner bounce, bass shelf, exhaustGain, new pops, public read-only `popCount: number`; `reset()` restores all layer state.
- `src/audio/soundSpec.ts` — modify — add `cylVar` [0, 0.5] default 0.28, `bassDb` [0, 12] default 8, `exhaustGain` (0, 2] default 1 to the synth type and parser; errors name `synth.cylVar`, `synth.bassDb`, `synth.exhaustGain`.
- `public/cars/*.json` — modify — `sound.synth` only, per the design's "Data" list (pipeM/tailM × 1.5 capped at 5, gt3-d firingDeg, drive, exhaustGain, crackle).

## Steps

1. Core changes 1–6 and the Data list: follow the design section literally (it fixes constants, PRNG seed `seed·7919 + 13`, draw order, pop window and probability).
2. Do not touch other files in `src/`. Do not change other `public/cars/*.json` fields.
3. Update frozen tests per the authorisation below and list every changed assertion in the report.

Conventions: kernel table and filters in `Float64Array`; pop timing resolved at firing events; `popCount` counts since construction/reset; invalid spec values produce parser errors, never clamping.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `PULSE_KERNEL` | read | argmax index / KERNEL_N in [0.035, 0.045]; value at index KERNEL_N ≤ 1e-9; non-increasing after the argmax |
| AT2 | f4 and gt3-c synth from `public/cars` with `jitterDeg` 0, `jitterAmp` 0; voice seed 1, 48 kHz | for rpm 3000..7000 step 250, load 1, throttle 1: render 0.8 s, RMS of the last 0.5 s | max RMS / min RMS ≤ 1.6 per car (no comb sweep) |
| AT3 | same specs, `cylVar` 0.28 | steady 3000 rpm, load 1, 1.3 s, Hann-windowed DFT of the last 1.0 s | energy at orders 0.5, 1, 1.5 summed ≥ −20 dB relative to the firing order (cyl/2) |
| AT4 | f4 synth with `turbo` null, `drive` 0.5, `exhaustGain` 0.6 vs 1.0, same seed | steady 6000 rpm, load 1, 1 s | RMS ratio (0.6 / 1.0) in [0.5, 0.72] |
| AT5 | gt3-a synth with `drive` 0.5, `bassDb` 8 vs 0, same seed | steady 4000 rpm, load 1, 1 s, DFT | energy below 160 Hz rises ≥ 5 dB; energy above 1 kHz changes ≤ 1.5 dB |
| AT6 | f4 synth (crackle 0.8), seed 1 | 2 s at 6500 rpm throttle 1, then throttle 0 / load 0 with rpm 6000 for 3 s, blocks of 128, record `popCount` per block | ≥ 3 pops between 0.08 and 2.2 s after the lift; none before 0.08 s or after 2.2 s; consecutive pops ≥ 25 ms apart (block resolution); `crackle` 0 → 0 pops; throttle kept at 1 → 0 pops; rpm 3000 during overrun → 0 pops |
| AT7 | any car synth | render 1 s mixed controls, `reset()`, render again | both renders bit-identical; two voices with the same seed bit-identical |
| AT8 | `public/cars/*.json` | compare with `git show master:` at test-writing time | `pipeM`/`tailM` = 1.5 × master (±1e-9, cap 5); gt3-d firingDeg as above; ow26 firingDeg unchanged; drive/exhaustGain/crackle as in the data list |
| AT9 | `parseEngineSynth` | `cylVar` 0.6, `bassDb` −1, `exhaustGain` 0 | one error each naming `synth.cylVar`, `synth.bassDb`, `synth.exhaustGain`; absent → defaults 0.28, 8, 1 |

Frozen-test edits authorised: assertions in 227/228/231 acceptance and edge tests that encode the old kernel shape, reflection, loop low-pass, crackle timing/arming, car `pipeM`/`tailM`/gt3-d firing or the "bit-identical to 227" layer-off rule may be updated to the v2.1 behaviour; the coder lists every changed assertion in the report.

## Acceptance criteria

- [ ] All AT rows pass; remaining 227/228/231 tests pass (with the authorised edits only).
- [ ] No allocation inside `render`; `reset()` voice renders identically to a fresh one.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Worklet/EngineAudio wiring (229), turbo transients (239), mixer (230), offline render tool (232).
- Any change to `engineSynth.ts` or to car fields other than `sound.synth`.

## Planner-authorised test edits

In addition to the design's authorised 227/228/231 edits (kernel, reflection, loop LP, crackle, pipeM/tailM, gt3-d, layer-off), which remain authorised:
- `tests/unit/acceptance/226-engine-sound-spec.test.ts` AT3: add `cylVar: 0.2`, `bassDb: 4`, `exhaustGain: 0.8` to `FULL_RAW` (non-default, in range); nothing else.
- `tests/unit/edge/227-engine-voice-core.post.test.ts` POST4: re-scope to `cylVar: 0` (with zero jitter and zero cylVar the seed does not affect the output).
- `tests/unit/edge/244-engine-voice-timbre-edge.test.ts` EDGE6: delete only the strict `expect(low.peak).toBeLessThan(high.peak)` line (~295); the ≤ 1.5 dB bypass check stays. Near-equal peaks make the strict order phase-dependent.
- Confirmed covered: `231` AT4 (gt3-d firing 90/54 → even 72) and `228` EDGE6/EDGE7 (crackle timing/arming) updated to the new behaviour.

## Planner answers (round 4, supersedes earlier hints)

My earlier "corner ≥ 250 Hz on the final bus" hint was wrong; follow design item 4 literally:
- Exhaust path order: core tubes/228 modes/pops → muffling LP → (turbo ≠ null: second 2-pole LP) → RBJ low-shelf S = 1 at **160 Hz**, gain `bassDb` → × `exhaustGain` → soft clip. Intake, turbo and whine layers are summed after and bypass LP2, shelf and exhaustGain. AT5 row now measures below 160 Hz (planner change).
- 227 AT1 (|mean| 0.0048): the asymmetric clip after the bass boost adds DC. Add the reference's second DC blocker (`dc2`, 10 Hz, `docs/design/engine-audio-ref/voice-h5.ts` ~line 283) after the soft clip. Do not edit 227 AT1.
- 228 AT4/AT5 (turbo band +0.04 dB, transient 0.81): the turbo layer is being filtered/scaled with the exhaust path; it must bypass as above. Do not edit these tests.
- Authorised (crackle timing/arming): in 228 AT9, 228 EDGE6/EDGE7/EDGE8 and 228 POST13 replace signal cluster counting with `popCount` deltas over the same windows, same expected counts. 228 AT10 follows.
- Authorised (kernel shape, loop low-pass): 227 AT2 expected lag and 227 AT7 > 20 kHz limit may be updated to the v2.1 measured value with a 3 dB / 10 % margin; list old and new values in the report.
- 244 EDGE6 strict-order line delete (above) stays.
- Authorised: `tests/unit/acceptance/244-engine-voice-timbre.test.ts` AT5 — change the low band upper bound 250 → 160 Hz (and the title); nothing else.
- Not yours: 253 AT6, 225 EDGE3 (task 256), 224 POST4.

## Planner answers (round 5)

- 227 AT1: DC of 0.0048 (−46 dBFS) is inaudible and comes from the output tanh on the sharper v2.1 kernel. Keep dc2 where the design puts it. Authorised: relax 227 AT1 `|mean|` limit 1e-3 → 1e-2; nothing else in that test.
- 228 AT4/AT5 (turbo band): first port the prototype's turbo-car exhaust muffling if missing (`render-h5.ts` line 66: moving average over `maN` samples before the muffling low-passes when `turbo` ≠ null; and `drive × 0.7` for turbo cars, line 37). Re-measure. If still failing, raise `TURBO_AMP` to the smallest value that passes both (cap 4.5) and report old/new. If 4.5 is not enough, BLOCK with the measured dB. Do not edit 228 AT4/AT5.
- 244 AT5 (+2.03 dB): the clip compresses the boost on gt3-a (drive 2.0); the row now fixes `drive` 0.5 (planner change). Authorised: set `drive: 0.5` in the AT5 spec override in `tests/unit/acceptance/244-engine-voice-timbre.test.ts`; nothing else.
- Accepted: 227 AT2 → 17.8 ms ±13 %, 227 AT7 → −25 dB, 228 popCount rewrites, neutral runner draw at cylVar 0.

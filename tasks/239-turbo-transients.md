# 239 — Turbo transients: blow-off/bypass valve, surge flutter, wastegate, spool-down

Status: pending
Phase: 1
Depends on: 228, 231
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Turbo cars gain throttle-lift transients (blow-off / bypass valve, compressor surge flutter, external wastegate, asymmetric spool-down) driven by five new optional `TurboLayer` fields, with data for f4, hyper-a and ow26.

## Context

Design `docs/design/engine-audio-v2.md`, section "239 — Turbo transients": implement its rules exactly. Research: `docs/research/engine-audio/turbo-transients.md` (§2 table, §4 recipe). Task 228 is not merged yet: use the names defined by 226/227/228 (`TurboLayer`, `parseEngineSynth`, `EngineVoice`, `VoiceControl`, `setControl`, `render`), not the current code's names. Same constraints as 227/228 (pure TS, seeded PRNG, no allocation in `render`).

The acceptance tests use the design's "Test base" paragraph (base config, "lift from L", `d`, `B`, envelope, centroid definitions); the acceptance worker must read it.

## Files

- `src/audio/soundSpec.ts` — modify — `TurboLayer` + `parseEngineSynth` (turbo part only).
- `src/audio/engineVoice.ts` — modify — boost slew and transients; exported names and signatures unchanged.
- `public/cars/f4.json`, `public/cars/hyper-a.json`, `public/cars/ow26.json` — modify — `sound.synth.turbo` only; all other keys untouched.
- `src/audio/engineSynth.ts` — DO NOT modify.

## Steps

Contract (types in `src/audio/soundSpec.ts`):

```ts
export interface TurboLayer {
  // existing: centerHz, spanHz, gain, lagS
  valve?: 'none' | 'bpv' | 'bov';
  flutter?: number;        // [0,1]
  wastegate?: number;      // [0,1]
  wastegateKind?: 'internal' | 'external';
  downLagS?: number;       // [0,5] s
}
```

1. Parser: all five fields optional; absent stays absent (no defaults inserted; existing deep-equal tests unchanged); invalid values push an error containing `synth.turbo`, following the existing turbo error style.
2. Voice effective defaults: valve `'none'`, flutter 0, wastegate 0, wastegateKind `'internal'`, `downLagS = lagS`. Boost = load slewed up with `lagS`, down with `downLagS`.
3. Trigger, recipes, gains, noise seed (`seed + 7`), sum point (before the final soft clip, bypassing the exhaust low-pass): exactly as in the design section. With every transient off the output is sample-identical to 228.
4. Car data per the design "Car data" paragraph (f4, hyper-a, ow26 values; `downLagS = 1.5 × lagS` written as a literal number: f4 0.45, hyper-a 0.75, ow26 0.675).

Conventions: throttle fall rate uses the last control update's Δthrottle/Δt (Δt = samples rendered since the previous `setControl`; none rendered → no trigger); `throttle` clamped to [0,1]; non-finite fall rate → no trigger; transients never mutate the spec.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | valve 'bov', lift from 1 | d over t 0.02-0.35 s | RMS between B·10^(−12/20) and B·10^(−1/20); centroid in [3000, 7000] Hz |
| AT2 | valve 'bov', lift from 1 | d over t 1.2-1.5 s | RMS < 0.01·B |
| AT3 | valve 'bov'; lift from 1 vs lift from 0.4 vs lift from 0.2 | d energy over t 0-0.5 s | from 1 ≥ 6 dB above from 0.4; from 0.2: max \|d\| < 1e-6 |
| AT4 | valve 'bpv' vs 'bov', lift from 1 | d over t 0.02-0.35 s | bpv centroid in [800, 3000] Hz; bpv energy ≥ 10 dB below bov |
| AT5 | flutter 1, valve 'none', lift from 1 | envelope of d over t 0-1 s; peaks = local maxima ≥ 6 dB above the minima on both sides | 6 to 8 peaks; mean interval between consecutive peaks in [1/14, 1/7] s |
| AT6 | flutter 0.4, lift from 1 | same | 2 to 4 peaks |
| AT7 | wastegate 1, wastegateKind 'internal' vs 'external', lift from 1 | d | internal: max \|d\| < 1e-6 everywhere; external: RMS over the last 1 s before the lift between B·10^(−20/20) and B·10^(−6/20), and RMS over t 0-0.15 s ≥ 2 × that |
| AT8 | downLagS 1.2 vs 0.3 (valve 'none'), lift from 1 | read public `boost` at t 0.7 s; 3-6 kHz band energy of the output over t 0.6-0.8 s | boost(1.2) ≥ 3 × boost(0.3); band energy ≥ 0.5 dB higher with 1.2 |
| AT9 | turbo without the new fields vs explicit `valve 'none', flutter 0, wastegate 0, wastegateKind 'internal', downLagS 0.4`; lift from 1 | 3 s output | arrays identical |
| AT10 | valve 'bov', flutter 0.4, wastegate 0.5 external, lift from 1, but throttle and load ramp 1 → 0 in steps of 0.05 every 50 ms | d over the whole run after the ramp start | max \|d\| < 1e-6 except the held external wastegate before boost drops below 0.7 (check only t ≥ 0.3 s after the ramp start: max \|d\| < 1e-6) |
| AT11 | 6 cyl, rpm 15000, valve 'bov', flutter 1, wastegate 1 external, lift from 1 | 3 s | no NaN/Inf; max \|x\| ≤ 0.9 |
| AT12 | parse raws: valve 'x'; flutter 2; wastegate −1; wastegateKind 'y'; downLagS 9; and a valid turbo with all five fields | parse | each invalid has ≥ 1 error containing `synth.turbo`; valid round-trips the five values; a turbo without them keeps them absent |
| AT13 | car JSONs | parse `sound.synth.turbo` | f4 valve 'bpv', flutter 0.4; hyper-a valve 'bpv', flutter 0, wastegate 0.3, 'internal'; ow26 valve 'bpv', flutter 0, wastegate 0.5, 'external'; each downLagS = 1.5 × its lagS (± 1e-9) |
| AT14 | — | all 226, 227, 228 and 231 acceptance tests | pass |

## Acceptance criteria

- [ ] All AT rows pass, including the 226, 227, 228 and 231 acceptance tests; `engineSynth.ts` unchanged.
- [ ] No allocation inside `render`.
- [ ] Only the three car JSONs listed are modified, and only their `sound.synth.turbo`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Worklet/EngineAudio wiring (229), mixer (230), offline render tool (232), new cars, brand names, crackle/limiter changes, tuning beyond the design recipes.

## Planner answers (round 1)

- AT8 changed (planner): at 7000 rpm / load 0 the exhaust masks the unchanged turbo layer, so the row now checks the spool-down state. Add a public read-only `boost: number` to `EngineVoice` (current slewed boost, 0 after `reset()`). Authorised: rewrite only the AT8 test to the new row (boost ratio ≥ 3 at t 0.7 s, band energy ≥ +0.5 dB). Turbo gain and TURBO_AMP stay unchanged.
- Accepted: wastegate hold gate, transient level reference, flutter/chuff rules, setControl trigger rule. Run the full `npm test` before reporting.

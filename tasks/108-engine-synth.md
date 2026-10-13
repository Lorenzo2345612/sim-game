# 108 — Engine synth DSP core

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure, deterministic, Node-testable engine sound generator (combustion pulses + exhaust resonance + intake noise) with no Web Audio dependency.

## Context

M1.7 plan (`docs/plans/m1.7-audio.md`). Wrapped by an AudioWorklet in task 109, so the file must import nothing (no `three`, no DOM, no Web Audio types) and must not call `Math.random`.

## Files

- `src/audio/engineSynth.ts` — create.
- `tests/unit/audio/engineSynth.test.ts` — create — edge tests.

## Steps

```ts
export interface EngineSynthParams { cylinders: number; exhaustLengthM: number; intakeMix: number; sampleRate: number }
export function firingHz(rpm: number, cylinders: number): number; // rpm/60 · cylinders/2 (four-stroke)
export class EngineSynth {
  constructor(p: EngineSynthParams, seed: number);
  render(out: Float32Array, rpm: number, throttle: number): void; // fills the whole `out`
}
```

- Firing: a phase accumulator at `firingHz`; each event starts an exponentially decaying burst, τ = 0.25 / firingHz s. Amplitude = (0.2 + 0.8·throttle) · (1 + 0.1·j), j a seeded per-cylinder jitter in [-1, 1] (cylinder index cycles per event).
- Exhaust: feedback comb filter, delay = round(2·exhaustLengthM/343 · sampleRate) samples (min 1), feedback 0.5, applied to the burst signal.
- Intake: white noise through a one-pole low-pass at 800 Hz, times `intakeMix` · throttle, added to the exhaust signal.
- Output through `tanh` soft clip: always finite, |x| ≤ 1.
- rpm and throttle ramp linearly sample-by-sample across each block from the previous block's values (first block starts at its own values). All state (phase, burst envelope, comb buffer, noise filter, PRNG) persists between blocks.
- PRNG: mulberry32 seeded by `seed`; `Math.random` forbidden.

Conventions: rpm < 0 treated as 0 (silent firing, no NaN); throttle clamped to [0, 1]; non-finite rpm/throttle treated as 0; `cylinders` not integer in 1..12 or `sampleRate` ≤ 0 throws in the constructor; blocks of any length ≥ 1; `out` is overwritten, not mixed.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/108-engine-synth.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 4 cyl, L 1.2, intake 0.3, 48 kHz, rpm 6000, throttle 1 | render 1 s (blocks of 128) | strongest autocorrelation peak for lags 1/1000–1/50 s at 1/200 s ± 2 % |
| AT2 | 8 cyl, same | same | peak at 1/400 s ± 2 % |
| AT3 | 4 cyl, rpm 4000 | RMS throttle 1 vs throttle 0 | ≥ 2× |
| AT4 | 2000 random blocks (seeded), rpm 0–9000, throttle 0–1 | render | every sample finite and |x| ≤ 1 |
| AT5 | same params and seed twice | render 0.5 s | identical arrays |
| AT6 | block at rpm 3000 then block at 3010, throttle 0.5 | render | |out[0] of block 2 − out[127] of block 1| ≤ 0.2 |
| AT7 | 4 cyl | render 1 s at 48 kHz in Node | < 50 ms |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Extra tests: negative/NaN rpm, constructor throws, block length 1, different seeds give different output.
- [ ] No imports in the file; no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- AudioWorklet, Web Audio nodes, wiring (109); effects (110); filters beyond those listed; per-car tuning.

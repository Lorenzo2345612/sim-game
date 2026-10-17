# 232 — Offline engine render tool

Status: pending
Phase: 1
Depends on: 227
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`npm run audio:render -- --car <id>` renders deterministic WAV scenarios and a metrics JSON for a car's engine voice, so the sound can be inspected without a browser.

## Context

Design: `docs/design/engine-audio-v2.md` (scenarios paragraph under 232). Uses `EngineVoice` (task 227, `src/audio/engineVoice.ts`) and `legacySynthSpec`/`parseEngineSynth` (`src/audio/soundSpec.ts`). Car data from `public/cars/<id>.json` via `parseCarSpec` (`src/physics/carSpec.ts`; `sound`, `engine.idleRpm`, `engine.limiterRpm`). Tools run with `tsx` (see other `tools/` scripts in `package.json`). Output dir `.ai/audio` is not committed.

## Files

- `tools/audio/renderEngine.ts` — create (CLI plus exported pure helpers).
- `package.json` — modify: add script `"audio:render": "tsx tools/audio/renderEngine.ts"`.
- `tests/unit/acceptance/232-engine-render-tool.test.ts` — create (unit parts); `tests/e2e` not used: AT1/AT5 spawn the CLI via `child_process` inside the Vitest test.

## Steps

```ts
export interface ScenarioMetrics { peak: number; rms: number; dcMean: number; f0Hz: number | null }
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array; // RIFF PCM 16-bit mono
export function f0Autocorr(x: Float32Array, sampleRate: number): number | null;     // 227 AT2 method
```
1. CLI args: `--car <id>` (required), `--out <dir>` (default `.ai/audio`). Unknown car (no file) → write `Unknown car: <id>` to stderr, exit 1. Create `<dir>` recursively.
2. Sample rate 48000; voice seed 1; render in 128-sample blocks, calling `setControl` per block (throttle = load unless stated). Warm-up 0.5 s before each scenario, not written. Scenarios (L = limiterRpm): idle 2 s (idleRpm, load 0.1, throttle 0.1); mid 2 s (0.6·L, load 1); redline 2 s (L − 200, load 1); sweep 5 s (idleRpm → L linearly over 4 s at load 1, then 1 s at L with `limiter` true); lift 2 s (L − 500 at load 1 for 0.5 s, then throttle 0 and load 0). `wheelSpeedMs` 0 always.
3. Outputs `<car>-<scenario>.wav` and `<car>.json` (`{ car, sampleRate, scenarios: { idle|mid|redline|sweep|lift: ScenarioMetrics } }`, pretty-printed, 6-decimal numbers). `f0Hz` from the first 1.5 s of idle/mid/redline only (null for sweep and lift); `peak` = max |x| of the written float samples.
4. Spec = `parseEngineSynth(sound.synth, sound).spec` (falls back to legacy when `synth` absent); parse errors → stderr, exit 1.
5. Output is byte-deterministic (no timestamps, no `Math.random`).

Conventions: samples clamped to [-1, 1] and rounded to nearest int16 (×32767); `f0Hz` null when no autocorrelation peak ≥ 0.3; files overwritten.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run -s audio:render -- --car f4 --out <tmp>` | run | exit 0; files `f4-idle.wav`, `f4-mid.wav`, `f4-redline.wav`, `f4-sweep.wav`, `f4-lift.wav`, `f4.json` in `<tmp>` |
| AT2 | the wavs | parse RIFF header | PCM 16-bit, mono, 48000 Hz; durations idle 2 s, mid 2 s, redline 2 s, sweep 5 s, lift 2 s (± 1 %) |
| AT3 | `f4.json` | read | per scenario `peak ≤ 0.9`, `|dcMean| < 1e-3`; `mid.f0Hz` within 1 % of `0.6·limiterRpm/60·cyl/2` |
| AT4 | two runs, same car | compare | byte-identical outputs |
| AT5 | `--car nope` | run | exit ≠ 0; stderr contains `nope` |

## Acceptance criteria

- [ ] All AT rows pass; `npm run audio:render` exists in `package.json`.
- [ ] `tools/audio/renderEngine.ts` imports nothing from `three`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Playback, spectrograms, other cars' tuning, CI integration, stereo, resampling, committing rendered files.

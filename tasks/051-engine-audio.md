# 051 — Engine and tyre audio

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Procedural engine sound driven by rpm and throttle, plus tyre squeal driven by slip, using the Web Audio API.

## Context

No audio assets: oscillators and gain nodes only. Browsers block audio until a user gesture; `AudioContext` is injected (factory) so tests use a mock. Param functions are pure. Acceptance tests for this task are Vitest in `tests/unit/acceptance/`.

## Files

- `src/audio/engineAudio.ts` — create.
- `tests/unit/audio/engineAudio.test.ts` — create — extra edge tests with an AudioContext mock.

## Steps

```ts
export interface EngineParams { frequencyHz: number; gain: number }
/** frequencyHz = rpm / 60 * 2 (4-cylinder, 2 firings per revolution). gain rises monotonically with throttle in [0.15, 0.6] at master 1. */
export function engineParams(rpm: number, throttle: number): EngineParams;
/** Max squeal gain 0.5; 0 when the slip ratio of every wheel < 0.1; ramps linearly 0.1..0.2+ ; counts wheels with slip > 0.1. */
export function tyreSquealGain(slipRatios: readonly number[]): number;
export class EngineAudio {
  constructor(createContext?: () => AudioContext); // default: new AudioContext()
  start(): void;                      // safe before user gesture: never throws; resumes on first call to resume()
  resume(): void;                     // call from a user-gesture handler
  update(rpm: number, throttle: number, slipRatios: readonly number[]): void;
  setMasterVolume(v: number): void;   // 0..1, default 0.5; 0 → all gains 0
  dispose(): void;                    // stop oscillators, close context
}
```

- Engine: sawtooth oscillator at `frequencyHz` plus a second at 2× with half amplitude, low-pass filter; tyre squeal: filtered noise or high square oscillator through its own gain.
- Squeal AT3 contract: slip ratios `[0.25, 0.25, 0, 0]` → gain > 0; `[0.05, 0.05, 0.05, 0.05]` → 0.
- Gain changes use `setTargetAtTime` (smoothing 0.05 s) not direct assignment, so no clicks.
- Master volume 0: both channels' target gain 0.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/051-engine-audio.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rpm 3000 → 9000 | `engineParams(rpm, throttle)` | base frequency = rpm/60 × 2 (4-cylinder) Hz; gain increases with throttle |
| AT2 | AudioContext mock | `EngineAudio.start()` before user gesture | does not throw; starts on first resume |
| AT3 | slip ratio > 0.2 on 2 wheels | `tyreSquealGain` | > 0; 0 when slip < 0.1 |
| AT4 | master volume 0 | gains | all 0 |

## Acceptance criteria

- [ ] All AT rows pass; no audio files added.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring and slip computation in `main.ts`/vehicle (task 054), skid marks, music, collision sounds, volume UI.


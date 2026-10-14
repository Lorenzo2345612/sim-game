# 109 — Engine AudioWorklet and EngineAudio integration

Status: pending
Phase: 1
Depends on: 107, 108, 054, 070
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The game's engine sound is produced by `EngineSynth` inside an AudioWorklet using the active car's `sound` data, keeping the old oscillators as fallback.

## Context

M1.7 plan (`docs/plans/m1.7-audio.md`). `src/audio/engineAudio.ts` (task 051) keeps its public API: `start`, `resume`, `update(rpm, throttle, slipRatios)`, `setMasterVolume`, `dispose`, plus pure `engineParams`, `tyreSquealGain`. Audio is wired in `src/main.ts` by 054 (created at boot, `resume()` on first gesture, `update` per frame). Tests inject the context via the constructor factory.

## Files

- `src/audio/engineWorklet.ts` — create — `AudioWorkletProcessor` wrapping `EngineSynth`.
- `src/audio/engineAudio.ts` — modify — worklet path, fallback, stats.
- `src/main.ts` — modify — pass `car.sound` to `EngineAudio`; extend `__SIMGAME__` (and its `Window` type).
- `tests/unit/audio/engineAudioFallback.test.ts` — create — edge tests with a stub context.

## Steps

```ts
// EngineAudio gains an optional second constructor argument:
constructor(createContext?: () => AudioContext, sound?: CarSound /* from carSpec; default DEFAULT_CAR_SOUND */)
getStats(): { running: boolean; engine: 'worklet' | 'oscillator'; firingHz: number }
// window.__SIMGAME__.audioStats(): same shape, delegating to getStats()
```

- Bundling: `engineWorklet.ts` is a separate Vite module loaded with `ctx.audioWorklet.addModule(new URL('./engineWorklet.ts', import.meta.url))`; Vite bundles it as its own worker-style asset. It may import only `./engineSynth` (108) and must NOT import `three` or anything touching DOM/Web Audio constructors beyond the worklet globals (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`); declare those globals locally.
- Processor `'engine-synth'`: `processorOptions` = `{ cylinders, exhaustLengthM, intakeMix, seed }` with `sampleRate` from the global; `AudioParam`s or `port.postMessage({ rpm, throttle })` carry rpm/throttle (coder's choice, one only); renders each 128-frame block via `EngineSynth.render`; returns `true`.
- `EngineAudio`: if `ctx.audioWorklet` is undefined or `addModule` rejects, use the existing oscillators and report `engine: 'oscillator'`; before `addModule` resolves, sound uses nothing (no throw) and stats report `'oscillator'` until the node is connected. The worklet node connects through the existing master/lowpass-free chain to destination; `setMasterVolume` scales it. Tyre squeal keeps working in both modes.
- `firingHz` in stats = `firingHz(lastRpm, sound.cylinders)` from the last `update`; `running` = started and not disposed.
- `dispose()` disconnects the worklet node and closes the context.

Conventions: `update` before the worklet is ready only stores values; stats never throw; after `dispose` `running` is false.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/109-engine-worklet.test.ts` (AT2) and `tests/e2e/acceptance/109-engine-worklet.spec.ts` (AT1, AT3) before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e monza, click to start audio, throttle 2 s | `audioStats()` | running true, engine 'worklet', firingHz = rpm·cylinders/120 ± 1 (rpm from `__SIMGAME__`) |
| AT2 | unit: EngineAudio with a stub context lacking `audioWorklet` | create + update | engine 'oscillator', no throw |
| AT3 | e2e | whole run | no console errors |

## Acceptance criteria

- [ ] All AT rows pass; existing 051 tests still pass.
- [ ] `grep -n "three" src/audio/engineWorklet.ts` returns nothing.
- [ ] `npm run build` succeeds and the worklet is emitted as a separate asset.
- [ ] AT1 needs `__SIMGAME__` to expose rpm (an existing getter or add `rpm(): number` if missing).

## Verification

```
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test 109-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Effects (shift cut, crackle, wind, kerb, gravel) (110); volume settings, cockpit filter, pause mute (111); AI car sounds and spatial/positional audio (race milestone); new sound data fields.

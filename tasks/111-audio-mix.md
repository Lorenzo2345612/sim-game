# 111 — Audio mix

Status: pending
Phase: 1
Depends on: 110
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Persisted master/engine/effects volumes, a cockpit-camera engine lowpass and muting while paused.

## Context

M1.7 plan. `src/core/settings.ts` currently stores only `{ preset }` under `SETTINGS_KEY`; `savePreset` overwrites the whole value, so it must be changed to preserve other keys. Camera modes: `CameraMode` in `src/render/cameraRig.ts` (`'chase' | 'tcam' | 'cockpit'`). Pause state is `paused` in `src/main.ts`.

## Files

- `src/core/settings.ts` — modify — volume load/save; `savePreset` merges.
- `src/audio/mixer.ts` — create — gain/filter logic over injected nodes.
- `src/main.ts` — modify — wire mixer, camera mode and pause.
- `tests/unit/audio/mixer.test.ts` — create — edge tests with mock nodes.

## Steps

```ts
export interface Volumes { master: number; engine: number; effects: number }
export const DEFAULT_VOLUMES: Volumes; // { master: 0.8, engine: 1, effects: 1 }
export function loadVolumes(storage: KeyValueStorage): Volumes;
export function saveVolumes(storage: KeyValueStorage, v: Volumes): void; // key `volume` inside the SETTINGS_KEY JSON
export class Mixer {
  constructor(ctx: AudioContext, nodes: { master: GainNode; engine: GainNode; effects: GainNode; engineFilter: BiquadFilterNode }, volumes: Volumes);
  setCameraMode(mode: CameraMode): void; // cockpit: engineFilter lowpass 1200 Hz; others: bypass (frequency 22050)
  setPaused(paused: boolean): void;      // master gain ramps to 0 / back to volumes.master over 0.1 s
  setVolumes(v: Volumes): void;
}
```

- `EngineAudio` exposes the nodes the Mixer needs (engine gain, effects gain, filter, master) without changing its existing public API.
- Main: `setCameraMode` on camera change, `setPaused` on pause/resume, volumes loaded at boot.
- Ramps use `linearRampToValueAtTime` anchored with `setValueAtTime` at `ctx.currentTime`.

Conventions: volumes clamped to [0, 1]; missing, non-numeric or corrupt stored values fall back per field to defaults; `savePreset`/`saveVolumes` preserve unrelated keys; no mutation of the `Volumes` argument.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/111-audio-mix.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: settings without volume | load | master 0.8, engine 1, effects 1 |
| AT2 | unit: mixer with cockpit camera / chase camera | engine filter | lowpass 1200 Hz / bypass |
| AT3 | unit: pause then resume | master gain ramps | to 0 within 0.1 s, back to master within 0.1 s |

## Acceptance criteria

- [ ] All AT rows pass; existing preset tests (`loadPreset`/`savePreset`) still pass.
- [ ] Saving a preset keeps stored volumes and vice versa.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Volume UI/sliders; AI car sounds and spatial audio; new effects.

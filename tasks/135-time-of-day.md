# 135 — Time of day presets

Status: pending
Phase: 2
Depends on: 093, 099, 106, 130
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The scene supports `day`, `sunset` and `night` presets (HDRI, sun, ambient, fog) selected per track, by `?tod=` or by the race config.

## Context

Design: `docs/plans/game-features.md` section 135. Extends `applyEnvironment`, `ENV_TABLE`, `EnvironmentInfo`, `ShadowRig` in `src/render/environment.ts` (099: HDRI + PMREM, `scene.environmentIntensity = 0.7`, fog colour from the HDRI horizon). Tracks `lusail` and `bahrain` are loadable after 106. Assets installed by the planner before this task (do not create): `public/hdri/tod_sunset_2k.hdr` and `public/hdri/tod_night_2k.hdr` (Poly Haven CC0, lines in `ASSETS_LICENSES.md`). `day` uses the track's existing `ENV_TABLE` HDRI. Acceptance e2e: `tests/e2e/acceptance/135-time-of-day.spec.ts`.

## Files

- `src/core/timeOfDay.ts` — create: `TimeOfDay`, `TRACK_DEFAULT_TOD`, `defaultTimeOfDay`, `parseTimeOfDay` (core, so `src/game` can import the type)
- `src/render/environment.ts` — modify: `TOD_TABLE`, `applyEnvironment`, `ShadowRig`
- `src/main.ts` — modify: resolve tod, pass it, `SceneStats` gains `timeOfDay: TimeOfDay` and `sunElevationDeg: number`
- `src/game/raceGame.ts` — modify: `RaceConfig` gains optional `timeOfDay?: TimeOfDay` (type only; 093 behaviour unchanged)

## Steps

```ts
// src/core/timeOfDay.ts
export type TimeOfDay = 'day' | 'sunset' | 'night';
export const TRACK_DEFAULT_TOD: Record<string, TimeOfDay>; // lusail, bahrain, singapore, lasvegas: 'night'
export function defaultTimeOfDay(trackId: string): TimeOfDay; // table or 'day'
export function parseTimeOfDay(value: string | null | undefined): TimeOfDay | null; // exact lowercase match else null
// src/render/environment.ts (imports TimeOfDay)
export interface TodPreset { hdri: string | null; sunElevationDeg: number; sunIntensity: number; ambientScale: number }
export const TOD_TABLE: Record<TimeOfDay, TodPreset>;
export function applyEnvironment(scene: THREE.Scene, trackId: string, renderer: THREE.WebGLRenderer, tod?: TimeOfDay): Promise<EnvironmentInfo>; // tod default = defaultTimeOfDay(trackId)
// EnvironmentInfo gains: timeOfDay: TimeOfDay
// ShadowRig gains: setTimeOfDay(tod: TimeOfDay): void
```

1. `TOD_TABLE`: day `{ hdri: null, sunElevationDeg: 48, sunIntensity: 2, ambientScale: 1 }` (keeps the current sun offset (150, 200, 100)); sunset `{ hdri: 'tod_sunset', 8, 1.2, 0.8 }`; night `{ hdri: 'tod_night', 25, 0.08, 0.25 }`.
2. `applyEnvironment`: HDRI file `public/hdri/<hdri>_2k.hdr` (or the track's for `day`); `EnvironmentInfo.name` = the HDRI base name (e.g. `tod_night`); `scene.environmentIntensity = 0.7 · ambientScale`; fog colour from that HDRI's horizon (099 path), density from `FOG_TABLE`.
3. `ShadowRig.setTimeOfDay`: light intensity = `sunIntensity`; sun offset = 269.26 m (length of (150, 200, 100)) along the horizontal azimuth of (150, 100) at `sunElevationDeg`.
4. `main.ts` precedence: `RaceConfig.timeOfDay`, then `?tod=` (`parseTimeOfDay`, invalid ignored), then `defaultTimeOfDay(track.id)`. `sceneStats().sunElevationDeg` = the preset elevation.

Conventions: unknown track id → `day`; invalid `?tod=` value ignored (never throws); HDR load failure rejects (as 099); dispose previous textures on re-call (099).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=lusail` | sceneStats | timeOfDay 'night'; environment = night HDRI name |
| AT2 | e2e `/?track=monza&tod=sunset` | sceneStats | timeOfDay 'sunset'; sun elevation < 15° |
| AT3 | e2e screenshot sky band at night vs day | mean luminance | night < 0.3 × day |

## Acceptance criteria

- [ ] All AT rows pass; 099 tests still pass (`/?track=monza` stays `day`).
- [ ] No console errors in any of the three e2e cases.

## Verification

```
npm run typecheck
npm run lint
npm run test:e2e
```

## Out of scope

- Floodlights, headlights and the floodlit shader term (task 136).
- Time-of-day menu UI, animated time progression, moon/stars, fetching the HDRIs.

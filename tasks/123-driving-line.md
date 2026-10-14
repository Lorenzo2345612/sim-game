# 123 — Driving line overlay coloured by action

Status: pending
Phase: 2
Depends on: 088, 093, 118
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A ribbon drawn on the racing line shows where to accelerate (green), coast (yellow) and brake (red), with a setting to hide it or show only braking.

## Context

Design: `docs/plans/game-features.md` section 123. `RacingLine` (`points` x,z interleaved, `dist`, `length`) from `src/ai/racingLine.ts` (087); per-point speeds from `speedProfile` in `src/ai/speedProfile.ts` (088); the race session from `src/game/raceGame.ts` (093) exposes the line/profile and the player's state; if the single-car `Game` is used, build the line with `computeRacingLine(track.centerline, track.widthMeters / 2)`. `src/ai` imports only core/track. Settings: `src/core/settings.ts` (`SETTINGS_KEY`, keep other keys on save). Render code may import `three`. e2e: `tests/e2e/acceptance/123-driving-line.spec.ts`.

## Files

- `src/ai/lineActions.ts` — create.
- `src/render/drivingLine.ts` — create.
- `src/core/settings.ts` — modify: `export type DrivingLineMode = 'off' | 'braking' | 'full'` and `loadDrivingLineSetting(storage): DrivingLineMode` (default `'off'`; invalid → `'off'`).
- `src/main.ts` — modify: create/dispose the overlay in the session; `sceneStats().drivingLine: { visible: boolean; vertexCount: number }`; URL `?line=off|braking|full` overrides the setting.
- `tests/unit/acceptance/123-driving-line.test.ts` — acceptance worker.

## Steps

```ts
export const ACTION_THROTTLE = 0, ACTION_COAST = 1, ACTION_BRAKE = 2;
export function lineActions(speeds: Float64Array, dist: Float64Array, length: number): Uint8Array;
import type { DrivingLineMode } from '../core/settings';
export class DrivingLine {
  constructor(line: RacingLine, speeds: Float64Array, y: (x: number, z: number) => number);
  readonly object: THREE.Object3D;
  setMode(mode: DrivingLineMode): void;
  update(carDistance: number, carSpeed: number): void;
  dispose(): void;
  readonly vertexCount: number;
}
```

1. `lineActions`: per point i, next = speeds[(i+1) mod n]. Brake (2) if `next < speeds[i] − 0.05`; else coast (1) if `|next − speeds[i]| ≤ 0.05` and `speeds[i] < 0.97·max(speeds)`; else throttle (0). Empty input returns an empty array; `dist`/`length` unused for the rule (kept for signature stability).
2. Ribbon 0.6 m wide, 2 cm above `y(x, z)`, one quad per line segment, vertex colours green `#2ecc40`, yellow `#ffdc00`, red `#ff4136` per action; single mesh, `MeshBasicMaterial({vertexColors, transparent, opacity 0.8, depthWrite false})`.
3. `update`: segments within the next 200 m ahead of `carDistance` (wrapping) whose profile speed < `carSpeed − 2` are recoloured red (rewrite only the colour buffer; no allocation per call).
4. Modes: `off` hides the mesh; `braking` shows only segments with action brake or the dynamic red ones; `full` shows all (non-shown segments collapsed or alpha 0 via colour buffer, no geometry rebuild). `vertexCount` = 4 × segments (≥ 2 × line points).
5. `main.ts` default mode: `loadDrivingLineSetting`.

Conventions: thresholds as written (`<` and `≤`); input arrays not mutated; wrap-around index for the last point.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | speeds [50,50,40,30,30,30,40,50] (closed), dist spacing 10 | lineActions | [throttle, brake, brake, coast, coast, throttle, throttle, throttle] |
| AT2 | constant speeds = vMax | lineActions | all throttle |
| AT3 | e2e monza, drivingLine full | sceneStats().drivingLine | visible, vertex count ≥ 2 × line points |
| AT4 | e2e drivingLine off | same | not visible |

## Acceptance criteria

- [ ] AT1–AT4 pass.
- [ ] `grep -n "from 'three'" src/ai/lineActions.ts` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Braking boards (124), assist presets (125), settings UI, ghost line, line for AI cars.
